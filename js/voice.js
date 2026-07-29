import { state } from "./state.js";
import { canMutateOrders, isOrderHiddenForCurrentRole } from "./roles.js";
import { createOrderFromVoicePayload } from "./orders.js";
import { formatAmountWholeRubles } from "./format.js";

const VOICE_CHAT_STORAGE_PREFIX = "orders_site_voice_chat_v1:";
/** Сколько реплик хранить на странице и в localStorage (в LLM уходит только хвост). */
const MAX_STORED_CHAT_MESSAGES = 80;
const VOICE_EMPTY_HTML =
  '<p class="voice-empty">Спросите про заказ голосом или текстом — например: «Какая сумма по последнему заказу?» или «Создай заказ клиенту Иванову на 50 тысяч, адрес Ленина 10».</p>';

/** @type {SpeechRecognition | null} */
let recognition = null;
/** @type {{ role: string, content: string }[]} */
let chatHistory = [];
/** @type {Record<string, unknown> | null} */
let pendingOrderDraft = null;
let listening = false;
let busy = false;
/** Постоянный Audio: iOS разблокирует play() только после жеста пользователя. */
let ttsAudio = null;
let ttsAudioUnlocked = false;
/** @type {string | null} */
let ttsObjectUrl = null;
/** Последний текст — если iOS заблокировал play, можно нажать «Прослушать». */
let lastSpeakText = "";
/** @type {SpeechSynthesisVoice | null} */
let preferredBrowserVoice = null;
let browserVoicesReady = false;

/** Состояние одной сессии распознавания — чтобы onend не «съедал» ошибки и пустые ответы. */
/** @type {{
 *   id: number,
 *   gotSpeech: boolean,
 *   gotFinal: boolean,
 *   finals: string[],
 *   interim: string,
 *   errorCode: string | null,
 *   userStop: boolean,
 *   forceStop: boolean,
 * } | null} */
let listenSession = null;
let listenSessionSeq = 0;
/** @type {ReturnType<typeof setTimeout> | null} */
let listenWatchdogTimer = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let listenStartTimer = null;
/** Не очищать статус до этого момента (ошибки / подсказки должны остаться на экране). */
let statusHoldUntil = 0;
/** Идёт асинхронная подготовка микрофона (getUserMedia) — не давать второй старт. */
let startingListen = false;

const LISTEN_MAX_MS = 18000;
const LISTEN_START_TIMEOUT_MS = 12000;
const STATUS_HOLD_MS = 4500;
/** Пауза после остановки getUserMedia, чтобы WebKit отдал микрофон SpeechRecognition. */
const CAPTURE_PRIME_SETTLE_MS = 140;

/** Короткий тихий WAV — разблокировка WebKit без слышимого звука. */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function voiceChatStorageKey() {
  const id = state.currentUser?.id;
  return id ? `${VOICE_CHAT_STORAGE_PREFIX}${id}` : `${VOICE_CHAT_STORAGE_PREFIX}anon`;
}

function persistChatHistory() {
  try {
    const toSave = chatHistory.slice(-MAX_STORED_CHAT_MESSAGES).map((m) => ({
      role: m.role,
      content: String(m.content || "").slice(0, 2000),
    }));
    localStorage.setItem(voiceChatStorageKey(), JSON.stringify(toSave));
  } catch {
    /* quota / private mode */
  }
}

function loadChatHistoryFromStorage() {
  try {
    const raw = localStorage.getItem(voiceChatStorageKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m) =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.trim(),
      )
      .slice(-MAX_STORED_CHAT_MESSAGES)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  } catch {
    return [];
  }
}

function clearPersistedChatHistory() {
  try {
    localStorage.removeItem(voiceChatStorageKey());
  } catch {
    /* ignore */
  }
}

/** Добавить реплику в историю и сразу сохранить на диск. */
function pushChat(role, content) {
  chatHistory.push({ role, content: String(content || "") });
  if (chatHistory.length > MAX_STORED_CHAT_MESSAGES) {
    chatHistory = chatHistory.slice(-MAX_STORED_CHAT_MESSAGES);
  }
  persistChatHistory();
}

function renderFeedFromHistory() {
  const feed = document.getElementById("voiceFeed");
  if (!feed) return;
  if (!chatHistory.length) {
    feed.innerHTML = VOICE_EMPTY_HTML;
    return;
  }
  feed.innerHTML = "";
  for (const m of chatHistory) {
    appendBubble(m.role, m.content);
  }
}

function restoreChatHistoryIfNeeded() {
  if (chatHistory.length) {
    // Уже в памяти (переключение разделов без перезагрузки) — лента в DOM обычно цела.
    const feed = document.getElementById("voiceFeed");
    if (feed && !feed.querySelector(".voice-bubble") && chatHistory.length) {
      renderFeedFromHistory();
    }
    return;
  }
  chatHistory = loadChatHistoryFromStorage();
  if (chatHistory.length) renderFeedFromHistory();
}

function getSpeechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function ensureTtsAudioElement() {
  if (ttsAudio) return ttsAudio;
  const audio = new Audio();
  audio.preload = "auto";
  audio.setAttribute("playsinline", "true");
  audio.setAttribute("webkit-playsinline", "true");
  audio.playsInline = true;
  ttsAudio = audio;
  return audio;
}

/**
 * Вызывать синхронно из click/touch/keydown — иначе iPhone не даст воспроизвести TTS после fetch.
 * Не вызывать непосредственно перед SpeechRecognition.start(): silent WAV / warm utterance
 * оставляют аудиосессию в playback и микрофон «глухнет».
 */
function unlockTtsAudio() {
  if (ttsAudioUnlocked) return;
  const audio = ensureTtsAudioElement();

  try {
    audio.src = SILENT_WAV;
    const p = audio.play();
    if (p && typeof p.then === "function") {
      p.then(() => {
        ttsAudioUnlocked = true;
        try {
          audio.pause();
          audio.currentTime = 0;
        } catch {
          /* ignore */
        }
      }).catch(() => {
        /* жест мог быть недостаточным — попробуем снова на следующем тапе */
      });
    } else {
      ttsAudioUnlocked = true;
    }
  } catch {
    /* ignore */
  }
}

function scoreFemaleRuVoice(v) {
  const name = `${v.name} ${v.lang}`.toLowerCase();
  let score = 0;
  if (/^ru\b|ru-ru|russian|русск/.test(v.lang.toLowerCase()) || /russian|русск/.test(name)) score += 40;
  if (/irina|ирина|elena|елена|milena|милена|katya|катя|natalia|наталья|oksana|оксана|dariya|дария/.test(name)) {
    score += 50;
  }
  if (/female|woman|girl|женский|женщин/.test(name)) score += 30;
  if (/microsoft|google|premium|neural|natural/.test(name)) score += 10;
  if (/male|david|paul|mark|мужск/.test(name)) score -= 40;
  return score;
}

function pickPreferredBrowserVoice() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  if (!voices.length) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const v of voices) {
    const s = scoreFemaleRuVoice(v);
    if (s > bestScore) {
      bestScore = s;
      best = v;
    }
  }
  return bestScore >= 40 ? best : voices.find((v) => /^ru/i.test(v.lang)) || best;
}

function ensureBrowserVoices() {
  if (browserVoicesReady) return;
  preferredBrowserVoice = pickPreferredBrowserVoice();
  if (preferredBrowserVoice || (window.speechSynthesis?.getVoices?.() || []).length) {
    browserVoicesReady = true;
  }
  if (typeof window.speechSynthesis?.addEventListener === "function") {
    window.speechSynthesis.addEventListener(
      "voiceschanged",
      () => {
        preferredBrowserVoice = pickPreferredBrowserVoice();
        browserVoicesReady = true;
      },
      { once: true },
    );
  }
}

function speakBrowserFallback(utterText) {
  try {
    window.speechSynthesis?.cancel();
    ensureBrowserVoices();
    const u = new SpeechSynthesisUtterance(utterText);
    u.lang = "ru-RU";
    u.rate = 1;
    u.pitch = 1.05;
    if (preferredBrowserVoice) u.voice = preferredBrowserVoice;
    window.speechSynthesis?.speak(u);
  } catch (e) {
    console.warn("speechSynthesis:", e);
  }
}

function clearTtsObjectUrl() {
  if (ttsObjectUrl) {
    try {
      URL.revokeObjectURL(ttsObjectUrl);
    } catch {
      /* ignore */
    }
    ttsObjectUrl = null;
  }
}

function stopSpeaking() {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
  const audio = ttsAudio;
  if (!audio) return;
  try {
    audio.pause();
    audio.currentTime = 0;
  } catch {
    /* ignore */
  }
}

function isWebKitSpeech() {
  return typeof window.webkitSpeechRecognition === "function";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Перед записью останавливаем озвучку, но НЕ вызываем unlockTtsAudio():
 * silent WAV / warm utterance переводят iOS в playback и SpeechRecognition
 * часто стартует с красной кнопкой «Слушаю…», не слыша речь.
 * Не делаем src="" / load() — это раньше ломало и TTS, и распознавание (#6/#7).
 */
function prepareAudioSessionForListening() {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
  const audio = ttsAudio;
  if (!audio) return;
  try {
    if (!audio.paused) {
      audio.pause();
      audio.currentTime = 0;
    }
  } catch {
    /* ignore */
  }
}

/**
 * Коротко открываем и сразу закрываем микрофон через getUserMedia.
 * На iPhone после TTS аудиосессия остаётся в playback; этот «прайм»
 * переводит её в запись. Поток НЕ держим открытым — иначе он конкурирует
 * с webkitSpeechRecognition (как в откатанном #4).
 * @returns {Promise<boolean>} false если отказано в доступе
 */
async function primeCaptureSession() {
  if (!navigator.mediaDevices?.getUserMedia) return true;
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (e) {
    const name = e?.name || "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
      return false;
    }
    // Другие ошибки (NotFound и т.п.) — всё равно пробуем SpeechRecognition.
    console.warn("primeCaptureSession:", e);
    return true;
  }
  try {
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  await sleep(CAPTURE_PRIME_SETTLE_MS);
  return true;
}

function disposeRecognition() {
  if (!recognition) return;
  const rec = recognition;
  recognition = null;
  try {
    rec.onstart = null;
    rec.onend = null;
    rec.onerror = null;
    rec.onresult = null;
    rec.onaudiostart = null;
    rec.onspeechstart = null;
    rec.onspeechend = null;
    rec.onnomatch = null;
    rec.onaudioend = null;
  } catch {
    /* ignore */
  }
  try {
    rec.abort();
  } catch {
    /* ignore */
  }
}

function markSpeechHeard() {
  if (!listenSession) return;
  listenSession.gotSpeech = true;
}

function showReplayHint() {
  const feed = document.getElementById("voiceFeed");
  if (!feed || !lastSpeakText) return;
  if (feed.querySelector("[data-voice-replay]")) return;
  const wrap = document.createElement("div");
  wrap.className = "voice-replay-wrap";
  wrap.innerHTML = `<button type="button" class="voice-replay-btn" data-voice-replay="1">▶ Прослушать ответ</button>`;
  feed.appendChild(wrap);
  feed.scrollTop = feed.scrollHeight;
}

async function playTtsBlob(blob, utterText) {
  const audio = ensureTtsAudioElement();
  clearTtsObjectUrl();
  const url = URL.createObjectURL(blob);
  ttsObjectUrl = url;

  const onEnded = () => {
    clearTtsObjectUrl();
    audio.removeEventListener("ended", onEnded);
    audio.removeEventListener("error", onError);
    // Мягко отпускаем playback после озвучки. Не трогаем src/load —
    // жёсткий сброс раньше ломал разблокировку Audio на iPhone.
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {
      /* ignore */
    }
  };
  const onError = () => {
    clearTtsObjectUrl();
    audio.removeEventListener("ended", onEnded);
    audio.removeEventListener("error", onError);
    speakBrowserFallback(utterText);
  };
  audio.addEventListener("ended", onEnded);
  audio.addEventListener("error", onError);

  audio.src = url;
  try {
    await audio.play();
    ttsAudioUnlocked = true;
    document.querySelectorAll(".voice-replay-wrap").forEach((el) => el.remove());
  } catch (e) {
    console.warn("tts play blocked:", e);
    speakBrowserFallback(utterText);
    showReplayHint();
    setStatus("Нажмите «Прослушать ответ», чтобы услышать голос на iPhone.", false);
  }
}

async function speak(text) {
  const utterText = String(text || "").trim();
  if (!utterText) return;
  lastSpeakText = utterText;
  stopSpeaking();

  try {
    const res = await fetch("/api/voice-tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: utterText, voice: "nova" }),
    });
    if (!res.ok) {
      speakBrowserFallback(utterText);
      return;
    }
    const blob = await res.blob();
    if (!blob || blob.size < 32) {
      speakBrowserFallback(utterText);
      return;
    }
    await playTtsBlob(blob, utterText);
  } catch (e) {
    console.warn("voice-tts play:", e);
    speakBrowserFallback(utterText);
    showReplayHint();
  }
}

/**
 * @param {string} text
 * @param {boolean} [isError]
 * @param {{ holdMs?: number, tone?: "info" | "listening" | "error" | "" }} [opts]
 */
function setStatus(text, isError = false, opts = {}) {
  const el = document.getElementById("voicePageMessage");
  if (!el) return;
  const msg = text || "";
  const holdMs = opts.holdMs ?? (isError && msg ? STATUS_HOLD_MS : 0);
  if (holdMs > 0) statusHoldUntil = Date.now() + holdMs;
  else if (!msg) statusHoldUntil = 0;

  el.textContent = msg;
  const tone = opts.tone || (isError && msg ? "error" : msg ? "info" : "");
  el.classList.toggle("voice-page-message--error", tone === "error");
  el.classList.toggle("voice-page-message--listening", tone === "listening");
  el.classList.toggle("voice-page-message--info", tone === "info");
}

function setLiveTranscript(text, { interim = false } = {}) {
  const el = document.getElementById("voiceLiveTranscript");
  if (!el) return;
  const t = String(text || "").trim();
  if (!t) {
    el.hidden = true;
    el.textContent = "";
    el.classList.remove("voice-live-transcript--interim");
    return;
  }
  el.hidden = false;
  el.classList.toggle("voice-live-transcript--interim", interim);
  el.textContent = interim ? `Слышу: «${t}»…` : `Распознано: «${t}»`;
}

function clearListenTimers() {
  if (listenWatchdogTimer != null) {
    clearTimeout(listenWatchdogTimer);
    listenWatchdogTimer = null;
  }
  if (listenStartTimer != null) {
    clearTimeout(listenStartTimer);
    listenStartTimer = null;
  }
}

function forceResetListeningUi(message, isError = true) {
  clearListenTimers();
  listening = false;
  startingListen = false;
  setMicUi(false);
  setLiveTranscript("");
  if (message) setStatus(message, isError, { holdMs: STATUS_HOLD_MS, tone: isError ? "error" : "info" });
}

function setMicUi(active) {
  const btn = document.getElementById("voiceMicBtn");
  if (!btn) return;
  btn.classList.toggle("voice-mic-btn--active", active);
  btn.setAttribute("aria-pressed", active ? "true" : "false");
  btn.title = active ? "Слушаю… нажмите, чтобы остановить" : "Нажмите и говорите";
}

function setBusyUi(on) {
  busy = on;
  const btn = document.getElementById("voiceMicBtn");
  const sendBtn = document.getElementById("voiceSendBtn");
  if (btn) btn.disabled = on;
  if (sendBtn) sendBtn.disabled = on;
}

function recognitionErrorMessage(err) {
  switch (err) {
    case "not-allowed":
    case "service-not-allowed":
      return "Нет доступа к микрофону. Разрешите микрофон в настройках Safari/браузера и попробуйте снова.";
    case "no-speech":
      return "Речь не услышана. Нажмите микрофон и говорите после сигнала «Слушаю…».";
    case "audio-capture":
      return "Не удалось получить звук с микрофона. Проверьте, что микрофон не занят другим приложением.";
    case "network":
      return "Ошибка сети при распознавании речи. Проверьте интернет и попробуйте ещё раз.";
    case "bad-grammar":
    case "language-not-supported":
      return "Распознавание русской речи недоступно в этом браузере. Введите текст вручную.";
    default:
      return `Ошибка распознавания (${err}). Попробуйте ещё раз или введите текст.`;
  }
}

function appendBubble(role, text, extraHtml = "") {
  const feed = document.getElementById("voiceFeed");
  if (!feed) return;
  feed.querySelector(".voice-empty")?.remove();
  const div = document.createElement("div");
  div.className = `voice-bubble voice-bubble--${role}`;
  div.innerHTML = `<div class="voice-bubble-text">${escapeHtml(text)}</div>${extraHtml}`;
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
}

function renderConfirmCard(draft) {
  const client = String(draft?.client || "—");
  const amount =
    draft?.amount != null && draft.amount !== ""
      ? `${formatAmountWholeRubles(Number(draft.amount))} ₽`
      : "—";
  const address = String(draft?.address || "—");
  const status = String(draft?.payment_status || "Контакт с клиентом");
  const type = String(draft?.order_type || "—");
  return `<div class="voice-confirm-card" role="group" aria-label="Подтверждение создания заказа">
    <p class="voice-confirm-title">Создать заказ?</p>
    <ul class="voice-confirm-list">
      <li><span>Клиент</span> ${escapeHtml(client)}</li>
      <li><span>Сумма</span> ${escapeHtml(amount)}</li>
      <li><span>Адрес</span> ${escapeHtml(address)}</li>
      <li><span>Тип</span> ${escapeHtml(type)}</li>
      <li><span>Статус</span> ${escapeHtml(status)}</li>
    </ul>
    <div class="voice-confirm-actions">
      <button type="button" class="btn-primary voice-confirm-yes" data-voice-confirm="yes">Создать</button>
      <button type="button" class="voice-confirm-no" data-voice-confirm="no">Отмена</button>
    </div>
    <p class="voice-confirm-hint">Или скажите «да» / «нет»</p>
  </div>`;
}

function clearConfirmCards() {
  document.querySelectorAll(".voice-confirm-card").forEach((el) => el.remove());
}

function buildOrdersContext() {
  const list = (state.allOrders || [])
    .filter((o) => o && o.deleted_at == null && !isOrderHiddenForCurrentRole(o))
    .slice()
    .sort((a, b) => Number(b.id) - Number(a.id));
  return list.slice(0, 280).map((o) => ({
    id: o.id != null && o.id !== "" ? Number(o.id) || o.id : null,
    order_number: o.order_number ?? null,
    client: o.client ?? null,
    phone: o.phone ?? null,
    address: o.address ?? null,
    description: o.description ?? null,
    order_type: o.order_type ?? null,
    payment_status: o.payment_status ?? null,
    order_date: o.order_date ?? null,
    amount: o.amount ?? null,
    prepayment: o.prepayment ?? null,
    prepayment_to: o.prepayment_to ?? null,
    remaining_amount: o.remaining_amount ?? null,
    remaining_to: o.remaining_to ?? null,
    delivery: o.delivery ?? null,
    delivery_date: o.delivery_date ?? null,
    installation: Boolean(o.installation),
    installation_date: o.installation_date ?? null,
    area_m2: o.area_m2 ?? null,
  }));
}

function isAffirmative(text) {
  const t = String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^(да|ага|угу|ок|окей|подтверждаю|создай|создать|согласен|хорошо|верно)(\s|$)/.test(t);
}

function isNegative(text) {
  const t = String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^(нет|не|отмена|отменить|не надо|стоп)(\s|$)/.test(t);
}

async function confirmPendingOrder() {
  const draft = pendingOrderDraft;
  pendingOrderDraft = null;
  clearConfirmCards();
  if (!draft) return;
  setBusyUi(true);
  setStatus("Создаю заказ…");
  try {
    const result = await createOrderFromVoicePayload(draft);
    appendBubble("assistant", result.message);
    pushChat("assistant", result.message);
    speak(result.message);
    setStatus(result.ok ? "" : result.message, !result.ok, result.ok ? undefined : { holdMs: STATUS_HOLD_MS });
  } catch (e) {
    const msg = e?.message || "Не удалось создать заказ";
    appendBubble("assistant", msg);
    pushChat("assistant", msg);
    speak(msg);
    setStatus(msg, true, { holdMs: STATUS_HOLD_MS });
  } finally {
    setBusyUi(false);
  }
}

function cancelPendingOrder(announce = true) {
  pendingOrderDraft = null;
  clearConfirmCards();
  if (!announce) return;
  const msg = "Создание заказа отменено.";
  appendBubble("assistant", msg);
  pushChat("assistant", msg);
  speak(msg);
  setStatus("");
}

async function callVoiceAssistant(message) {
  const res = await fetch("/api/voice-assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      history: chatHistory.slice(0, -1).slice(-10),
      orders: buildOrdersContext(),
      canCreateOrders: canMutateOrders(),
    }),
  });
  // history: без текущего user-сообщения (оно уходит в message), иначе дубль путает модель.
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || `Ошибка сервера (${res.status})`);
  }
  return data;
}

async function handleUserText(rawText, { fromVoice = false } = {}) {
  const text = String(rawText || "").trim();
  if (!text || busy) return;

  setLiveTranscript("");
  appendBubble("user", text);
  pushChat("user", text);

  if (pendingOrderDraft) {
    if (isAffirmative(text)) {
      await confirmPendingOrder();
      return;
    }
    if (isNegative(text)) {
      cancelPendingOrder(true);
      return;
    }
  }

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    const msg = "Нет соединения с интернетом. Проверьте сеть и отправьте сообщение ещё раз.";
    appendBubble("assistant", msg);
    pushChat("assistant", msg);
    setStatus(msg, true, { holdMs: STATUS_HOLD_MS });
    return;
  }

  setBusyUi(true);
  const short = text.length > 72 ? `${text.slice(0, 70)}…` : text;
  setStatus(fromVoice ? `Принято: «${short}». Думаю…` : "Думаю…", false, { tone: "info" });

  try {
    const data = await callVoiceAssistant(text);
    const speakText = String(data?.speak || "Готово.").trim();
    const action = data?.action || "answer";

    if (action === "propose_create_order" && data?.order && canMutateOrders()) {
      pendingOrderDraft = data.order;
      const confirmAsk =
        speakText.includes("?") || /подтверд|создать|верно/i.test(speakText)
          ? speakText
          : `${speakText} Подтвердите создание: скажите «да» или нажмите «Создать».`;
      appendBubble("assistant", confirmAsk, renderConfirmCard(data.order));
      pushChat("assistant", confirmAsk);
      speak(confirmAsk);
      setStatus("");
    } else {
      pendingOrderDraft = null;
      appendBubble("assistant", speakText);
      pushChat("assistant", speakText);
      speak(speakText);
      setStatus("");
    }
  } catch (e) {
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    const msg = offline
      ? "Нет соединения с интернетом. Ответ ассистента недоступен."
      : e?.message || "Ошибка ассистента";
    appendBubble("assistant", msg);
    pushChat("assistant", msg);
    speak(msg);
    setStatus(msg, true, { holdMs: STATUS_HOLD_MS });
  } finally {
    setBusyUi(false);
  }
}

function beginListenSession() {
  listenSessionSeq += 1;
  listenSession = {
    id: listenSessionSeq,
    gotSpeech: false,
    gotFinal: false,
    finals: [],
    interim: "",
    errorCode: null,
    userStop: false,
    forceStop: false,
  };
  return listenSession;
}

function finishListenSessionWithOutcome(session) {
  const finals = (session?.finals || []).map((s) => String(s || "").trim()).filter(Boolean);
  let text = finals.join(" ").replace(/\s+/g, " ").trim();

  // На iOS иногда приходит только interim без final — берём его, чтобы фраза не «пропадала».
  if (!text) {
    const interim = String(session?.interim || "").trim();
    if (interim) text = interim;
  }

  if (text) {
    setLiveTranscript(text, { interim: false });
    setStatus(`Принято: «${text.length > 72 ? `${text.slice(0, 70)}…` : text}»`, false, {
      tone: "info",
      holdMs: 2000,
    });
    void handleUserText(text, { fromVoice: true });
    return;
  }

  setLiveTranscript("");

  if (session?.errorCode && session.errorCode !== "aborted") {
    // Сообщение уже выставлено в onerror и удерживается.
    return;
  }

  if (session?.forceStop) {
    setStatus("Микрофон завис и был остановлен. Нажмите ещё раз и повторите фразу.", true, {
      holdMs: STATUS_HOLD_MS,
    });
    return;
  }

  if (session?.userStop) {
    setStatus("Запись остановлена — фраза не распознана. Можно сказать ещё раз.", false, {
      tone: "info",
      holdMs: STATUS_HOLD_MS,
    });
    return;
  }

  if (session?.gotSpeech) {
    setStatus("Вас слышно было, но текст не распознан. Говорите громче и чётче, затем сделайте паузу.", true, {
      holdMs: STATUS_HOLD_MS,
    });
    return;
  }

  if (session?.errorCode === "aborted" && !session?.userStop) {
    setStatus("Распознавание прервалось. Нажмите микрофон и попробуйте снова.", true, {
      holdMs: STATUS_HOLD_MS,
    });
    return;
  }

  setStatus("Речь не услышана. Нажмите микрофон, дождитесь «Слушаю…» и говорите.", false, {
    tone: "info",
    holdMs: STATUS_HOLD_MS,
  });
}

function ensureRecognition() {
  // На WebKit/iOS один экземпляр часто «глухнет» после TTS — создаём заново.
  if (recognition && isWebKitSpeech()) {
    disposeRecognition();
  }
  if (recognition) return recognition;
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return null;
  recognition = new Ctor();
  recognition.lang = "ru-RU";
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  recognition.onstart = () => {
    if (listenStartTimer != null) {
      clearTimeout(listenStartTimer);
      listenStartTimer = null;
    }
    listening = true;
    startingListen = false;
    setMicUi(true);
    setStatus("Слушаю… говорите сейчас", false, { tone: "listening" });
  };

  recognition.onaudiostart = () => {
    if (!listening) return;
    setStatus("Микрофон включён. Слушаю…", false, { tone: "listening" });
  };

  recognition.onspeechstart = () => {
    markSpeechHeard();
    setStatus("Слышу вас…", false, { tone: "listening" });
  };

  recognition.onspeechend = () => {
    if (!listenSession?.gotFinal) {
      setStatus("Речь закончилась, распознаю…", false, { tone: "info" });
    }
  };

  recognition.onnomatch = () => {
    markSpeechHeard();
    setStatus("Не удалось сопоставить речь с текстом. Попробуйте ещё раз.", true, {
      holdMs: STATUS_HOLD_MS,
    });
  };

  recognition.onend = () => {
    clearListenTimers();
    const session = listenSession;
    listening = false;
    startingListen = false;
    setMicUi(false);
    listenSession = null;

    // Сессию уже закрыл watchdog / принудительный сброс — не перезаписываем статус.
    if (!session) {
      if (!busy) setLiveTranscript("");
      return;
    }

    if (busy) {
      setLiveTranscript("");
      return;
    }

    finishListenSessionWithOutcome(session);
  };

  recognition.onerror = (event) => {
    const err = event?.error || "error";
    if (listenSession) listenSession.errorCode = err;

    // aborted при ручной остановке — сообщение выставит onend
    if (err === "aborted") return;

    listening = false;
    startingListen = false;
    setMicUi(false);
    setLiveTranscript("");
    setStatus(recognitionErrorMessage(err), true, { holdMs: STATUS_HOLD_MS });
  };

  recognition.onresult = (event) => {
    if (!listenSession || !event?.results) return;
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const res = event.results[i];
      const transcript = String(res?.[0]?.transcript || "").trim();
      if (!transcript) continue;
      if (res.isFinal) {
        listenSession.gotFinal = true;
        listenSession.finals.push(transcript);
        listenSession.interim = "";
        markSpeechHeard();
        setLiveTranscript(listenSession.finals.join(" "), { interim: false });
        setStatus(`Распознано: «${transcript}»`, false, { tone: "info" });
      } else {
        interim += (interim ? " " : "") + transcript;
      }
    }
    if (interim && !listenSession.gotFinal) {
      listenSession.interim = interim;
      markSpeechHeard();
      setLiveTranscript(interim, { interim: true });
      setStatus("Слышу вас…", false, { tone: "listening" });
    }
  };

  return recognition;
}

function armListenWatchdogs(sessionId) {
  clearListenTimers();

  listenStartTimer = setTimeout(() => {
    if (!listening && listenSession?.id === sessionId && !listenSession.gotFinal) {
      // onstart так и не пришёл — часто бывает при отказе/зависании на iOS
      listenSession.forceStop = true;
      forceResetListeningUi(
        "Не удалось запустить микрофон. Разрешите доступ к микрофону или обновите страницу.",
        true,
      );
      disposeRecognition();
      listenSession = null;
    }
  }, LISTEN_START_TIMEOUT_MS);

  listenWatchdogTimer = setTimeout(() => {
    if (!listening || listenSession?.id !== sessionId) return;
    if (listenSession) listenSession.forceStop = true;
    setStatus("Слишком долгое ожидание — останавливаю микрофон…", true, { tone: "error" });
    try {
      recognition?.stop();
    } catch {
      /* ignore */
    }
    // Если onend не пришёл (зависание WebKit) — принудительно сбрасываем UI
    setTimeout(() => {
      if (listening && listenSession?.id === sessionId) {
        forceResetListeningUi("Микрофон завис и был сброшен. Нажмите ещё раз и повторите фразу.", true);
        disposeRecognition();
        listenSession = null;
      }
    }, 1600);
  }, LISTEN_MAX_MS);
}

/**
 * Запуск распознавания. На WebKit после TTS сначала коротко праймим
 * getUserMedia (и сразу закрываем), без авто-перезапусков сессии —
 * они давали цикл «завис → восстановился → завис».
 */
async function startListening() {
  if (busy || startingListen || listening) return;
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    setStatus(
      "Голосовой ввод не поддерживается в этом браузере. Введите текст вручную (на iPhone лучше Safari актуальной версии).",
      true,
      { holdMs: STATUS_HOLD_MS },
    );
    return;
  }

  startingListen = true;

  // Останавливаем озвучку без silent WAV / speechSynthesis warm —
  // иначе iPhone часто даёт «Микрофон включён. Слушаю…» без распознавания.
  prepareAudioSessionForListening();

  setMicUi(true);
  setLiveTranscript("");
  setStatus("Подключаю микрофон…", false, { tone: "listening" });

  // На WebKit после любой озвучки/unlock нужен прайм. Делаем его всегда:
  // коротко и без удержания потока — иначе легко поймать «глухой» STT.
  if (isWebKitSpeech()) {
    const ok = await primeCaptureSession();
    // Пользователь мог нажать «стоп» пока ждали getUserMedia.
    if (!startingListen) return;
    if (!ok) {
      forceResetListeningUi(
        "Нет доступа к микрофону. Разрешите микрофон в настройках Safari/браузера и попробуйте снова.",
        true,
      );
      return;
    }
    if (busy) {
      startingListen = false;
      setMicUi(false);
      return;
    }
  }

  if (!startingListen) return;

  const rec = ensureRecognition();
  if (!rec) {
    startingListen = false;
    forceResetListeningUi("Не удалось запустить распознавание речи.", true);
    return;
  }

  beginListenSession();
  setStatus("Подключаю микрофон…", false, { tone: "listening" });
  armListenWatchdogs(listenSession.id);

  try {
    rec.start();
  } catch (e) {
    // InvalidStateError — экземпляр ещё «занят»; пересоздаём и пробуем один раз.
    disposeRecognition();
    const retry = ensureRecognition();
    if (!retry) {
      clearListenTimers();
      listenSession = null;
      forceResetListeningUi(e?.message || "Не удалось запустить микрофон", true);
      return;
    }
    try {
      retry.start();
    } catch (e2) {
      clearListenTimers();
      listenSession = null;
      forceResetListeningUi(e2?.message || "Не удалось запустить микрофон", true);
    }
  }
}

function toggleListening() {
  if (busy) return;
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    setStatus(
      "Голосовой ввод не поддерживается в этом браузере. Введите текст вручную (на iPhone лучше Safari актуальной версии).",
      true,
      { holdMs: STATUS_HOLD_MS },
    );
    return;
  }

  if (listening || startingListen) {
    if (listenSession) listenSession.userStop = true;
    const wasOnlyPriming = startingListen && !listening;
    startingListen = false;
    setStatus("Останавливаю…", false, { tone: "info" });
    try {
      recognition?.stop();
    } catch {
      forceResetListeningUi("Запись остановлена.", false);
      disposeRecognition();
      listenSession = null;
      return;
    }
    if (wasOnlyPriming) {
      clearListenTimers();
      disposeRecognition();
      listenSession = null;
      forceResetListeningUi("Запись остановлена.", false);
    }
    return;
  }

  // Разблокировку TTS делаем на других жестах / входе в раздел —
  // не прямо перед SpeechRecognition.
  void startListening();
}

function sendFromInput() {
  unlockTtsAudio();
  const input = document.getElementById("voiceComposerInput");
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  void handleUserText(text);
}

export function initVoiceSection() {
  ensureBrowserVoices();
  ensureTtsAudioElement();
  const navBtn = document.getElementById("voiceNavBtn");
  const micBtn = document.getElementById("voiceMicBtn");
  const sendBtn = document.getElementById("voiceSendBtn");
  const input = document.getElementById("voiceComposerInput");
  const feed = document.getElementById("voiceFeed");
  const clearBtn = document.getElementById("voiceClearBtn");

  if (navBtn) {
    navBtn.addEventListener("click", () => {
      unlockTtsAudio();
      import("./section-nav.js").then((m) => m.switchSection("voice"));
    });
  }

  if (micBtn) {
    micBtn.addEventListener("click", () => toggleListening());
  }

  if (sendBtn) {
    sendBtn.addEventListener("click", () => sendFromInput());
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      unlockTtsAudio();
      chatHistory = [];
      clearPersistedChatHistory();
      pendingOrderDraft = null;
      stopSpeaking();
      setLiveTranscript("");
      if (feed) {
        feed.innerHTML = VOICE_EMPTY_HTML;
      }
      setStatus("");
    });
  }

  restoreChatHistoryIfNeeded();

  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        unlockTtsAudio();
        sendFromInput();
      }
    });
  }

  if (feed) {
    feed.addEventListener("click", (e) => {
      const replay = e.target?.closest?.("[data-voice-replay]");
      if (replay) {
        unlockTtsAudio();
        document.querySelectorAll(".voice-replay-wrap").forEach((el) => el.remove());
        if (lastSpeakText) void speak(lastSpeakText);
        return;
      }
      const btn = e.target?.closest?.("[data-voice-confirm]");
      if (!btn) return;
      unlockTtsAudio();
      const v = btn.getAttribute("data-voice-confirm");
      if (v === "yes") void confirmPendingOrder();
      else if (v === "no") cancelPendingOrder(true);
    });
  }

  if (!getSpeechRecognitionCtor()) {
    setStatus(
      "В этом браузере нет распознавания речи — можно писать текстом. На iPhone нужен актуальный Safari.",
      false,
      { tone: "info", holdMs: STATUS_HOLD_MS },
    );
  }
}

export function onVoiceSectionEnter() {
  // Разблокируем TTS при входе в раздел (не в момент микрофона), чтобы озвучка
  // ответов работала, а старт записи не переводил iPhone в playback.
  unlockTtsAudio();
  restoreChatHistoryIfNeeded();
  const input = document.getElementById("voiceComposerInput");
  input?.focus?.({ preventScroll: true });
}

export function onVoiceSectionLeave() {
  stopSpeaking();
  clearListenTimers();
  setLiveTranscript("");
  startingListen = false;
  if (listening && recognition) {
    if (listenSession) listenSession.userStop = true;
    try {
      recognition.stop();
    } catch {
      /* ignore */
    }
  }
  listening = false;
  setMicUi(false);
  listenSession = null;
}
