import { state } from "./state.js";
import { canAccessSection, canMutateOrders, isOrderHiddenForCurrentRole } from "./roles.js";
import { createOrderFromVoicePayload, updateOrderFromVoicePayload } from "./orders.js";
import {
  createCalculationFromVoicePayload,
  resolveCalcFromPlaceForCurrentUser,
} from "./calculations.js";
import { formatAmountWholeRubles } from "./format.js";

const VOICE_CHAT_STORAGE_PREFIX = "orders_site_voice_chat_v1:";
/** Сколько реплик хранить на странице и в localStorage (в LLM уходит только хвост). */
const MAX_STORED_CHAT_MESSAGES = 80;
const VOICE_EMPTY_HTML =
  '<p class="voice-empty">Четыре сценария: спросить про заказы; создать заказ (клиент и статус); изменить заказ; записать расход в расчёты (сумма и на что потрачено).</p>';

/** @type {SpeechRecognition | null} */
let recognition = null;
/** @type {{ role: string, content: string }[]} */
let chatHistory = [];
/**
 * Ожидание подтверждения создания/правки.
 * @type {null | {
 *   kind: "create" | "update" | "incomplete_create" | "create_calculation" | "incomplete_calculation",
 *   draft: Record<string, unknown>,
 *   orderId?: number|string|null,
 * }}
 */
let pendingVoiceAction = null;
let listening = false;
let busy = false;
/**
 * TTS через Web Audio API, НЕ через HTMLAudioElement.
 * На iOS Safari HTMLAudioElement после озвучки оставляет AVAudioSession в playback,
 * и следующий webkitSpeechRecognition показывает «Слушаю…» (onaudiostart), но речь
 * не слышит — подтверждено в WICG/speech-api#96 и несколькими прошлыми фикс-PR.
 */
/** @type {AudioContext | null} */
let ttsCtx = null;
let ttsAudioUnlocked = false;
/** @type {AudioBufferSourceNode | null} */
let ttsSource = null;
/** Последний текст — если iOS заблокировал play, можно нажать «Прослушать». */
let lastSpeakText = "";
/** @type {SpeechSynthesisVoice | null} */
let preferredBrowserVoice = null;
let browserVoicesReady = false;

/**
 * Режим диалога: после озвучки ответа снова слушаем один раз (без повторного нажатия).
 * Не перезапускаем STT по mid-session no-speech — это глушит микрофон без жеста пользователя.
 */
let conversationMode = false;
/** @type {ReturnType<typeof setTimeout> | null} */
let autoListenTimer = null;
let pageInactiveListenersBound = false;

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
/** Короткий guard от двойного старта (InvalidStateError / повторный тап). */
let startingListen = false;

const LISTEN_MAX_MS = 18000;
/** Ожидание следующей фразы после ответа ассистента. */
const CONVERSATION_LISTEN_MS = 10000;
const LISTEN_START_TIMEOUT_MS = 12000;
const STATUS_HOLD_MS = 4500;
/** Пауза после TTS перед авто-стартом STT (аудиосессия iOS). */
const AUTO_LISTEN_AFTER_TTS_MS = 450;

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

function scrollVoiceFeedToEnd() {
  const feed = document.getElementById("voiceFeed");
  if (!feed) return;
  feed.scrollTop = feed.scrollHeight;
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
  scrollVoiceFeedToEnd();
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

function getAudioContextCtor() {
  return window.AudioContext || window.webkitAudioContext || null;
}

function ensureTtsAudioContext() {
  if (ttsCtx) return ttsCtx;
  const Ctor = getAudioContextCtor();
  if (!Ctor) return null;
  try {
    ttsCtx = new Ctor();
  } catch (e) {
    console.warn("AudioContext:", e);
    return null;
  }
  return ttsCtx;
}

/**
 * Вызывать синхронно из click/touch/keydown — иначе iPhone не даст озвучку после fetch.
 * Разблокируем AudioContext (resume), без HTMLAudioElement / silent WAV:
 * они оставляют аудиосессию в playback и микрофон «глухнет» на следующем распознавании.
 */
function unlockTtsAudio() {
  const ctx = ensureTtsAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    try {
      const p = ctx.resume();
      if (p && typeof p.then === "function") {
        p.then(() => {
          ttsAudioUnlocked = true;
        }).catch(() => {
          /* жест мог быть недостаточным — попробуем снова на следующем тапе */
        });
      } else {
        ttsAudioUnlocked = true;
      }
    } catch {
      /* ignore */
    }
  } else {
    ttsAudioUnlocked = true;
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
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    try {
      window.speechSynthesis?.cancel();
      ensureBrowserVoices();
      const u = new SpeechSynthesisUtterance(utterText);
      u.lang = "ru-RU";
      u.rate = 1;
      u.pitch = 1.05;
      if (preferredBrowserVoice) u.voice = preferredBrowserVoice;
      u.onend = done;
      u.onerror = done;
      window.speechSynthesis?.speak(u);
      setTimeout(done, Math.min(45000, Math.max(2500, String(utterText).length * 120)));
    } catch (e) {
      console.warn("speechSynthesis:", e);
      done();
    }
  });
}

function stopTtsSource() {
  const src = ttsSource;
  ttsSource = null;
  if (!src) return;
  try {
    // stop() должен вызвать onended у ожидающего playTtsViaWebAudio.
    src.stop(0);
  } catch {
    /* already stopped */
  }
  try {
    src.disconnect();
  } catch {
    /* ignore */
  }
}

function stopSpeaking() {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
  stopTtsSource();
}

function isWebKitSpeech() {
  return typeof window.webkitSpeechRecognition === "function";
}

/**
 * Перед записью останавливаем озвучку (Web Audio source + speechSynthesis).
 * Не трогаем HTMLAudioElement — его больше нет в TTS-пути.
 * Не вызываем unlock/silent WAV прямо перед SpeechRecognition.
 */
function prepareAudioSessionForListening() {
  stopSpeaking();
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

/**
 * decodeAudioData: Promise в современных браузерах, callbacks в старом Safari.
 * ArrayBuffer копируем — Safari его detaches.
 */
function decodeAudioBuffer(ctx, arrayBuffer) {
  return new Promise((resolve, reject) => {
    const copy = arrayBuffer.slice(0);
    let settled = false;
    const ok = (buf) => {
      if (settled) return;
      settled = true;
      resolve(buf);
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err || new Error("decodeAudioData failed"));
    };
    try {
      const ret = ctx.decodeAudioData(copy, ok, fail);
      if (ret && typeof ret.then === "function") {
        ret.then(ok, fail);
      }
    } catch (e) {
      fail(e);
    }
  });
}

/**
 * Декодирует и проигрывает TTS через Web Audio API.
 * HTMLAudioElement намеренно не используем — на iPhone он ломает следующий STT.
 */
async function playTtsViaWebAudio(blob) {
  const ctx = ensureTtsAudioContext();
  if (!ctx) throw new Error("no AudioContext");

  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      /* продолжим — start() может всё равно сработать */
    }
  }

  const ab = await blob.arrayBuffer();
  const audioBuffer = await decodeAudioBuffer(ctx, ab);

  stopTtsSource();
  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(ctx.destination);
  ttsSource = source;

  await new Promise((resolve, reject) => {
    source.onended = () => {
      if (ttsSource === source) ttsSource = null;
      try {
        source.disconnect();
      } catch {
        /* ignore */
      }
      resolve();
    };
    try {
      source.start(0);
      ttsAudioUnlocked = true;
    } catch (e) {
      if (ttsSource === source) ttsSource = null;
      reject(e);
    }
  });
}

async function playTtsBlob(blob, utterText) {
  try {
    await playTtsViaWebAudio(blob);
    document.querySelectorAll(".voice-replay-wrap").forEach((el) => el.remove());
  } catch (e) {
    console.warn("tts web-audio play:", e);
    await speakBrowserFallback(utterText);
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
    // На WebKit просим WAV — decodeAudioData для MP3 на Safari менее надёжен.
    const format = isWebKitSpeech() ? "wav" : "mp3";
    const res = await fetch("/api/voice-tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: utterText, voice: "nova", format }),
    });
    if (!res.ok) {
      await speakBrowserFallback(utterText);
      return;
    }
    const blob = await res.blob();
    if (!blob || blob.size < 32) {
      await speakBrowserFallback(utterText);
      return;
    }
    await playTtsBlob(blob, utterText);
  } catch (e) {
    console.warn("voice-tts play:", e);
    await speakBrowserFallback(utterText);
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

function clearAutoListenTimer() {
  if (autoListenTimer != null) {
    clearTimeout(autoListenTimer);
    autoListenTimer = null;
  }
}

function endConversationMode() {
  conversationMode = false;
  clearAutoListenTimer();
}

function scheduleAutoListen() {
  clearAutoListenTimer();
  if (!conversationMode || busy || listening || startingListen) return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    endConversationMode();
    return;
  }

  autoListenTimer = setTimeout(() => {
    autoListenTimer = null;
    if (!conversationMode || busy || listening || startingListen) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      endConversationMode();
      return;
    }
    // Всегда новый экземпляр после TTS — иначе WebKit часто «глухой».
    disposeRecognition();
    startListening({ auto: true });
  }, AUTO_LISTEN_AFTER_TTS_MS);
}

async function speakThenMaybeListen(text) {
  try {
    await speak(text);
  } catch (e) {
    console.warn("speakThenMaybeListen:", e);
  }
  if (conversationMode && !busy) scheduleAutoListen();
}

function handlePageBecameInactive() {
  if (!conversationMode && !listening && !startingListen && autoListenTimer == null) return;
  endConversationMode();
  stopSpeaking();
  clearListenTimers();
  setLiveTranscript("");
  startingListen = false;
  if (listening && recognition) {
    if (listenSession) listenSession.userStop = true;
    try {
      recognition.stop();
    } catch {
      disposeRecognition();
      listenSession = null;
    }
  }
  listening = false;
  setMicUi(false);
  if (!busy) setStatus("");
}

function bindPageInactiveListeners() {
  if (pageInactiveListenersBound || typeof document === "undefined") return;
  pageInactiveListenersBound = true;
  // Только visibilitychange: pagehide/blur/freeze на iOS могут срабатывать
  // при старте микрофона и сразу глушить распознавание.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") handlePageBecameInactive();
  });
}

function forceResetListeningUi(message, isError = true) {
  clearListenTimers();
  clearAutoListenTimer();
  listening = false;
  startingListen = false;
  conversationMode = false;
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

function formatDraftFieldValue(key, value) {
  if (value == null || value === "") return "—";
  if (key === "amount" || key === "prepayment" || key === "remaining_amount") {
    return `${formatAmountWholeRubles(Number(value))} ₽`;
  }
  if (key === "installation") return value ? "да" : "нет";
  return String(value);
}

function buildConfirmListHtml(draft, { highlightMissing = false } = {}) {
  const rows = [
    ["client", "Клиент", true],
    ["payment_status", "Статус", true],
    ["phone", "Телефон", false],
    ["address", "Адрес", false],
    ["description", "Описание", false],
    ["order_type", "Тип", false],
    ["amount", "Сумма", false],
    ["prepayment", "Предоплата", false],
    ["prepayment_to", "Кому предоплата", false],
    ["remaining_amount", "Остаток", false],
    ["remaining_to", "Кому остаток", false],
    ["delivery", "Доставка", false],
    ["delivery_date", "Дата доставки", false],
    ["installation", "Монтаж", false],
    ["installation_date", "Дата монтажа", false],
  ];
  return rows
    .map(([key, label, required]) => {
      const raw = draft?.[key];
      const empty = raw == null || raw === "";
      if (empty && !required) return "";
      const missing = highlightMissing && required && empty;
      const value = missing ? "не указано" : formatDraftFieldValue(key, raw);
      const cls = missing ? ' class="voice-confirm-missing"' : "";
      return `<li${cls}><span>${label}${required ? " *" : ""}</span> ${escapeHtml(value)}</li>`;
    })
    .filter(Boolean)
    .join("");
}

function renderCreateConfirmCard(draft) {
  return `<div class="voice-confirm-card" role="group" aria-label="Подтверждение создания заказа">
    <p class="voice-confirm-title">Создать заказ?</p>
    <ul class="voice-confirm-list">
      ${buildConfirmListHtml(draft)}
    </ul>
    <div class="voice-confirm-actions">
      <button type="button" class="btn-primary voice-confirm-yes" data-voice-confirm="yes">Создать</button>
      <button type="button" class="voice-confirm-no" data-voice-confirm="no">Отмена</button>
    </div>
    <p class="voice-confirm-hint">Или скажите «да» / «нет»</p>
  </div>`;
}

function buildCalculationConfirmListHtml(draft, { highlightMissing = false } = {}) {
  const fromPlace = draft?.from_place || resolveCalcFromPlaceForCurrentUser();
  const toPlace = draft?.to_place || "Покупка";
  const rows = [
    ["from_place", "Откуда", false, fromPlace],
    ["to_place", "Куда", false, toPlace],
    ["amount", "Сумма", true, draft?.amount],
    ["description", "На что", true, draft?.description],
  ];
  return rows
    .map(([key, label, required, value]) => {
      const empty = value == null || value === "";
      const missing = highlightMissing && required && empty;
      let display;
      if (missing) display = "не указано";
      else if (key === "amount") display = formatDraftFieldValue("amount", value);
      else display = empty ? "—" : String(value);
      const cls = missing ? ' class="voice-confirm-missing"' : "";
      return `<li${cls}><span>${label}${required ? " *" : ""}</span> ${escapeHtml(display)}</li>`;
    })
    .join("");
}

function renderCalculationConfirmCard(draft) {
  return `<div class="voice-confirm-card" role="group" aria-label="Подтверждение записи расхода">
    <p class="voice-confirm-title">Записать расход?</p>
    <ul class="voice-confirm-list">
      ${buildCalculationConfirmListHtml(draft)}
    </ul>
    <div class="voice-confirm-actions">
      <button type="button" class="btn-primary voice-confirm-yes" data-voice-confirm="yes">Записать</button>
      <button type="button" class="voice-confirm-no" data-voice-confirm="no">Отмена</button>
    </div>
    <p class="voice-confirm-hint">Или скажите «да» / «нет»</p>
  </div>`;
}

function renderIncompleteCalculationCard(draft) {
  const missing = [];
  if (draft?.amount == null || !(Number(draft.amount) > 0)) missing.push("сумму");
  if (!String(draft?.description || "").trim()) missing.push("на что потрачены средства");
  const missingText = missing.length ? missing.join(" и ") : "обязательные поля";
  return `<div class="voice-confirm-card voice-confirm-card--incomplete" role="group" aria-label="Не хватает данных для расхода">
    <p class="voice-confirm-title">Нужны данные расхода</p>
    <p class="voice-confirm-missing-lead">Укажите: ${escapeHtml(missingText)} — голосом или текстом.</p>
    <ul class="voice-confirm-list">
      ${buildCalculationConfirmListHtml(draft, { highlightMissing: true })}
    </ul>
    <div class="voice-confirm-actions">
      <button type="button" class="voice-confirm-no" data-voice-confirm="no">Отмена</button>
    </div>
  </div>`;
}

function renderIncompleteCreateCard(draft) {
  const missing = [];
  if (!String(draft?.client || "").trim()) missing.push("клиент");
  if (!String(draft?.payment_status || "").trim()) missing.push("статус");
  const missingText = missing.length ? missing.join(" и ") : "обязательные поля";
  return `<div class="voice-confirm-card voice-confirm-card--incomplete" role="group" aria-label="Не хватает данных для заказа">
    <p class="voice-confirm-title">Нужны обязательные данные</p>
    <p class="voice-confirm-missing-lead">Укажите: ${escapeHtml(missingText)} — голосом или текстом.</p>
    <ul class="voice-confirm-list">
      ${buildConfirmListHtml(draft, { highlightMissing: true })}
    </ul>
    <div class="voice-confirm-actions">
      <button type="button" class="voice-confirm-no" data-voice-confirm="no">Отмена</button>
    </div>
  </div>`;
}

/** Найти заказ в локальном списке для карточки подтверждения правки. */
function findOrderForVoiceConfirm(orderId) {
  const idNum = Number(orderId);
  return (
    (state.allOrders || []).find((o) => {
      if (!o || o.deleted_at != null) return false;
      return Number(o.id) === idNum || o.id === orderId;
    }) || null
  );
}

/**
 * Для карточки правки: патч содержит только изменяемые поля, а Клиент/Статус
 * в списке обязательные — подставляем текущие значения заказа, если в патче пусто.
 */
function buildUpdateConfirmDisplay(orderId, patch) {
  const existing = findOrderForVoiceConfirm(orderId);
  const display = { ...(patch && typeof patch === "object" ? patch : {}) };
  if (display.client == null || display.client === "") {
    display.client = existing?.client ?? null;
  }
  if (display.payment_status == null || display.payment_status === "") {
    display.payment_status = existing?.payment_status ?? null;
  }
  return display;
}

function renderUpdateConfirmCard(orderId, patch) {
  return `<div class="voice-confirm-card" role="group" aria-label="Подтверждение изменения заказа">
    <p class="voice-confirm-title">Изменить заказ ${escapeHtml(String(orderId))}?</p>
    <ul class="voice-confirm-list">
      ${buildConfirmListHtml(buildUpdateConfirmDisplay(orderId, patch))}
    </ul>
    <div class="voice-confirm-actions">
      <button type="button" class="btn-primary voice-confirm-yes" data-voice-confirm="yes">Сохранить</button>
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
  return /^(да|ага|угу|ок|окей|подтверждаю|создай|создать|измени|изменить|сохрани|сохранить|согласен|хорошо|верно|запиши|записать|внеси|внести|добавь|добавить)(\s|$)/.test(
    t
  );
}

function isNegative(text) {
  const t = String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^(нет|не|отмена|отменить|не надо|стоп)(\s|$)/.test(t);
}

async function confirmPendingAction() {
  const pending = pendingVoiceAction;
  pendingVoiceAction = null;
  clearConfirmCards();
  if (!pending || pending.kind === "incomplete_create" || pending.kind === "incomplete_calculation") {
    return;
  }

  setBusyUi(true);
  const isUpdate = pending.kind === "update";
  const isCalc = pending.kind === "create_calculation";
  setStatus(isUpdate ? "Сохраняю изменения…" : isCalc ? "Записываю расход…" : "Создаю заказ…");
  try {
    const result = isUpdate
      ? await updateOrderFromVoicePayload(pending.orderId, pending.draft)
      : isCalc
        ? await createCalculationFromVoicePayload(pending.draft)
        : await createOrderFromVoicePayload(pending.draft);
    appendBubble("assistant", result.message);
    pushChat("assistant", result.message);
    setStatus(result.ok ? "" : result.message, !result.ok, result.ok ? undefined : { holdMs: STATUS_HOLD_MS });
    setBusyUi(false);
    await speakThenMaybeListen(result.message);
  } catch (e) {
    const msg =
      e?.message ||
      (isUpdate
        ? "Не удалось изменить заказ"
        : isCalc
          ? "Не удалось записать расход"
          : "Не удалось создать заказ");
    appendBubble("assistant", msg);
    pushChat("assistant", msg);
    setStatus(msg, true, { holdMs: STATUS_HOLD_MS });
    setBusyUi(false);
    await speakThenMaybeListen(msg);
  } finally {
    setBusyUi(false);
  }
}

function cancelPendingAction(announce = true) {
  const kind = pendingVoiceAction?.kind;
  pendingVoiceAction = null;
  clearConfirmCards();
  if (!announce) return;
  const msg =
    kind === "update"
      ? "Изменение заказа отменено."
      : kind === "incomplete_create"
        ? "Создание заказа отменено."
        : kind === "create_calculation" || kind === "incomplete_calculation"
          ? "Запись расхода отменена."
          : "Создание заказа отменено.";
  appendBubble("assistant", msg);
  pushChat("assistant", msg);
  setStatus("");
  void speakThenMaybeListen(msg);
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
      canCreateCalculations: canAccessSection("calculations"),
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

  if (
    pendingVoiceAction &&
    pendingVoiceAction.kind !== "incomplete_create" &&
    pendingVoiceAction.kind !== "incomplete_calculation"
  ) {
    if (isAffirmative(text)) {
      await confirmPendingAction();
      return;
    }
    if (isNegative(text)) {
      cancelPendingAction(true);
      return;
    }
  } else if (
    (pendingVoiceAction?.kind === "incomplete_create" ||
      pendingVoiceAction?.kind === "incomplete_calculation") &&
    isNegative(text)
  ) {
    cancelPendingAction(true);
    return;
  }

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    const msg = "Нет соединения с интернетом. Проверьте сеть и отправьте сообщение ещё раз.";
    appendBubble("assistant", msg);
    pushChat("assistant", msg);
    setStatus(msg, true, { holdMs: STATUS_HOLD_MS });
    if (conversationMode) await speakThenMaybeListen(msg);
    return;
  }

  setBusyUi(true);
  const short = text.length > 72 ? `${text.slice(0, 70)}…` : text;
  setStatus(fromVoice ? `Принято: «${short}». Думаю…` : "Думаю…", false, { tone: "info" });

  try {
    const data = await callVoiceAssistant(text);
    const speakText = String(data?.speak || "Готово.").trim();
    const action = data?.action || "answer";
    clearConfirmCards();

    if (action === "propose_create_calculation" && data?.calculation && canAccessSection("calculations")) {
      pendingVoiceAction = { kind: "create_calculation", draft: data.calculation };
      const confirmAsk =
        speakText.includes("?") || /подтверд|записать|верно|добавить/i.test(speakText)
          ? speakText
          : `${speakText} Подтвердите запись: скажите «да» или нажмите «Записать».`;
      appendBubble("assistant", confirmAsk, renderCalculationConfirmCard(data.calculation));
      pushChat("assistant", confirmAsk);
      setStatus("");
      setBusyUi(false);
      await speakThenMaybeListen(confirmAsk);
    } else if (action === "propose_create_order" && data?.order && canMutateOrders()) {
      pendingVoiceAction = { kind: "create", draft: data.order };
      const confirmAsk =
        speakText.includes("?") || /подтверд|создать|верно/i.test(speakText)
          ? speakText
          : `${speakText} Подтвердите создание: скажите «да» или нажмите «Создать».`;
      appendBubble("assistant", confirmAsk, renderCreateConfirmCard(data.order));
      pushChat("assistant", confirmAsk);
      setStatus("");
      setBusyUi(false);
      await speakThenMaybeListen(confirmAsk);
    } else if (
      action === "propose_update_order" &&
      data?.order &&
      data?.order_id != null &&
      canMutateOrders()
    ) {
      pendingVoiceAction = { kind: "update", draft: data.order, orderId: data.order_id };
      const confirmAsk =
        speakText.includes("?") || /подтверд|изменить|сохранить|верно/i.test(speakText)
          ? speakText
          : `${speakText} Подтвердите изменение: скажите «да» или нажмите «Сохранить».`;
      appendBubble("assistant", confirmAsk, renderUpdateConfirmCard(data.order_id, data.order));
      pushChat("assistant", confirmAsk);
      setStatus("");
      setBusyUi(false);
      await speakThenMaybeListen(confirmAsk);
    } else if (action === "clarify" && data?.calculation && canAccessSection("calculations")) {
      const missingAmount = data.calculation.amount == null || !(Number(data.calculation.amount) > 0);
      const missingDesc = !String(data.calculation.description || "").trim();
      if (missingAmount || missingDesc) {
        pendingVoiceAction = { kind: "incomplete_calculation", draft: data.calculation };
        appendBubble("assistant", speakText, renderIncompleteCalculationCard(data.calculation));
      } else {
        pendingVoiceAction = null;
        appendBubble("assistant", speakText);
      }
      pushChat("assistant", speakText);
      setStatus("");
      setBusyUi(false);
      await speakThenMaybeListen(speakText);
    } else if (action === "clarify" && data?.order && canMutateOrders()) {
      const missingClient = !String(data.order.client || "").trim();
      const missingStatus = !String(data.order.payment_status || "").trim();
      if (missingClient || missingStatus) {
        pendingVoiceAction = { kind: "incomplete_create", draft: data.order };
        appendBubble("assistant", speakText, renderIncompleteCreateCard(data.order));
      } else {
        pendingVoiceAction = null;
        appendBubble("assistant", speakText);
      }
      pushChat("assistant", speakText);
      setStatus("");
      setBusyUi(false);
      await speakThenMaybeListen(speakText);
    } else {
      pendingVoiceAction = null;
      appendBubble("assistant", speakText);
      pushChat("assistant", speakText);
      setStatus("");
      setBusyUi(false);
      await speakThenMaybeListen(speakText);
    }
  } catch (e) {
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    const msg = offline
      ? "Нет соединения с интернетом. Ответ ассистента недоступен."
      : e?.message || "Ошибка ассистента";
    appendBubble("assistant", msg);
    pushChat("assistant", msg);
    setStatus(msg, true, { holdMs: STATUS_HOLD_MS });
    setBusyUi(false);
    await speakThenMaybeListen(msg);
  } finally {
    setBusyUi(false);
  }
}

function beginListenSession({ auto = false } = {}) {
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
    fromAuto: Boolean(auto),
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
    // conversationMode остаётся — после ответа снова послушаем
    void handleUserText(text, { fromVoice: true });
    return;
  }

  setLiveTranscript("");
  const fromAuto = Boolean(session?.fromAuto);
  endConversationMode();

  if (session?.errorCode && session.errorCode !== "aborted" && session.errorCode !== "no-speech") {
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
    setStatus(
      fromAuto ? "" : "Запись остановлена — фраза не распознана. Можно сказать ещё раз.",
      false,
      fromAuto ? undefined : { tone: "info", holdMs: STATUS_HOLD_MS },
    );
    return;
  }

  // Тишина после ответа ассистента — просто синяя кнопка, без перезапуска STT.
  if (fromAuto) {
    setStatus("", false);
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

    // aborted / no-speech в диалоге — исход выставит onend (тихий выход к синей кнопке)
    if (err === "aborted") return;
    if (err === "no-speech" && conversationMode) return;

    listening = false;
    startingListen = false;
    endConversationMode();
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

function armListenWatchdogs(sessionId, { auto = false } = {}) {
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

  // После ответа ждём фразу до 10 с; первый старт по кнопке — как раньше (длиннее).
  const maxMs = auto ? CONVERSATION_LISTEN_MS : LISTEN_MAX_MS;

  listenWatchdogTimer = setTimeout(() => {
    if (!listening || listenSession?.id !== sessionId) return;
    if (listenSession) listenSession.forceStop = true;
    // Авто-слушание после ответа: тишина → синяя кнопка без ошибки.
    if (auto && !listenSession?.gotSpeech && !listenSession?.gotFinal) {
      listenSession.forceStop = false;
      endConversationMode();
      try {
        recognition?.stop();
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        if (listening && listenSession?.id === sessionId) {
          listening = false;
          startingListen = false;
          setMicUi(false);
          disposeRecognition();
          listenSession = null;
          setLiveTranscript("");
          setStatus("", false);
        }
      }, 1600);
      return;
    }
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
  }, maxMs);
}

/**
 * Запуск распознавания.
 * Первый старт — синхронно из жеста пользователя; после ответа — один авто-старт.
 * @param {{ auto?: boolean }} [opts]
 */
function startListening(opts = {}) {
  const auto = Boolean(opts.auto);
  if (busy || startingListen || listening) return;
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    endConversationMode();
    setStatus(
      "Голосовой ввод не поддерживается в этом браузере. Введите текст вручную (на iPhone лучше Safari актуальной версии).",
      true,
      { holdMs: STATUS_HOLD_MS },
    );
    return;
  }

  startingListen = true;
  if (!auto) conversationMode = true;

  // Останавливаем озвучку (Web Audio / speechSynthesis) без silent WAV.
  prepareAudioSessionForListening();

  setMicUi(true);
  setLiveTranscript("");
  setStatus("Подключаю микрофон…", false, { tone: "listening" });

  const rec = ensureRecognition();
  if (!rec) {
    startingListen = false;
    forceResetListeningUi("Не удалось запустить распознавание речи.", true);
    return;
  }

  beginListenSession({ auto });
  armListenWatchdogs(listenSession.id, { auto });

  try {
    rec.start();
  } catch (e) {
    // InvalidStateError — экземпляр ещё «занят»; пересоздаём и пробуем один раз.
    disposeRecognition();
    const retry = ensureRecognition();
    if (!retry) {
      clearListenTimers();
      listenSession = null;
      forceResetListeningUi(
        auto ? "Нажмите микрофон, чтобы снова слушать." : e?.message || "Не удалось запустить микрофон",
        !auto,
      );
      return;
    }
    try {
      retry.start();
    } catch (e2) {
      clearListenTimers();
      listenSession = null;
      forceResetListeningUi(
        auto ? "Нажмите микрофон, чтобы снова слушать." : e2?.message || "Не удалось запустить микрофон",
        !auto,
      );
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

  if (listening || startingListen || autoListenTimer != null) {
    clearAutoListenTimer();
    endConversationMode();
    if (listenSession) listenSession.userStop = true;
    startingListen = false;
    setStatus("Останавливаю…", false, { tone: "info" });
    try {
      recognition?.stop();
    } catch {
      forceResetListeningUi("Запись остановлена.", false);
      disposeRecognition();
      listenSession = null;
    }
    return;
  }

  // AudioContext уже разблокирован на входе в раздел / других жестах.
  // Не трогаем аудио здесь сверх stopSpeaking внутри startListening.
  startListening({ auto: false });
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
  bindPageInactiveListeners();
  // AudioContext создаём только по жесту (unlockTtsAudio) — иначе iOS держит suspended.
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
      endConversationMode();
      chatHistory = [];
      clearPersistedChatHistory();
      pendingVoiceAction = null;
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
        if (lastSpeakText) {
          void (async () => {
            await speak(lastSpeakText);
            if (conversationMode && !busy) scheduleAutoListen();
          })();
        }
        return;
      }
      const btn = e.target?.closest?.("[data-voice-confirm]");
      if (!btn) return;
      unlockTtsAudio();
      const v = btn.getAttribute("data-voice-confirm");
      if (v === "yes") void confirmPendingAction();
      else if (v === "no") cancelPendingAction(true);
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
  // Разблокируем AudioContext при входе в раздел (жест навигации), чтобы озвучка
  // ответов работала после fetch, не используя HTMLAudioElement.
  unlockTtsAudio();
  restoreChatHistoryIfNeeded();
  // Не фокусируем поле ввода: на iPhone focus открывает клавиатуру и панель
  // с галочкой, перекрывая историю и кнопку микрофона. Клавиатура — только
  // по явному тапу в поле; голос — по синей кнопке слева.
  const input = document.getElementById("voiceComposerInput");
  input?.blur?.();
  // После восстановления ленты показываем последнее сообщение над композером.
  requestAnimationFrame(() => {
    scrollVoiceFeedToEnd();
  });
}

export function onVoiceSectionLeave() {
  endConversationMode();
  stopSpeaking();
  clearListenTimers();
  setLiveTranscript("");
  startingListen = false;
  document.getElementById("voiceComposerInput")?.blur?.();
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
