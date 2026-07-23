import { state } from "./state.js";
import { canMutateOrders, isOrderHiddenForCurrentRole } from "./roles.js";
import { createOrderFromVoicePayload } from "./orders.js";
import { formatAmountWholeRubles } from "./format.js";

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
 */
function unlockTtsAudio() {
  const audio = ensureTtsAudioElement();
  try {
    // speechSynthesis тоже часто требует жест на iOS
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const warm = new SpeechSynthesisUtterance(" ");
      warm.volume = 0;
      warm.lang = "ru-RU";
      window.speechSynthesis.speak(warm);
      window.speechSynthesis.cancel();
    }
  } catch {
    /* ignore */
  }

  if (ttsAudioUnlocked) return;
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

function setStatus(text, isError = false) {
  const el = document.getElementById("voicePageMessage");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("voice-page-message--error", Boolean(isError && text));
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
    id: o.id,
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
    chatHistory.push({ role: "assistant", content: result.message });
    speak(result.message);
    setStatus(result.ok ? "" : result.message, !result.ok);
  } catch (e) {
    const msg = e?.message || "Не удалось создать заказ";
    appendBubble("assistant", msg);
    speak(msg);
    setStatus(msg, true);
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
  chatHistory.push({ role: "assistant", content: msg });
  speak(msg);
  setStatus("");
}

async function callVoiceAssistant(message) {
  const res = await fetch("/api/voice-assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      history: chatHistory.slice(-10),
      orders: buildOrdersContext(),
      canCreateOrders: canMutateOrders(),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || `Ошибка сервера (${res.status})`);
  }
  return data;
}

async function handleUserText(rawText, { fromVoice = false } = {}) {
  const text = String(rawText || "").trim();
  if (!text || busy) return;

  appendBubble("user", text);
  chatHistory.push({ role: "user", content: text });

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

  setBusyUi(true);
  setStatus(fromVoice ? "Распознано. Думаю…" : "Думаю…");

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
      chatHistory.push({ role: "assistant", content: confirmAsk });
      speak(confirmAsk);
      setStatus("");
    } else {
      pendingOrderDraft = null;
      appendBubble("assistant", speakText);
      chatHistory.push({ role: "assistant", content: speakText });
      speak(speakText);
      setStatus("");
    }
  } catch (e) {
    const msg = e?.message || "Ошибка ассистента";
    appendBubble("assistant", msg);
    speak(msg);
    setStatus(msg, true);
  } finally {
    setBusyUi(false);
  }
}

function ensureRecognition() {
  if (recognition) return recognition;
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return null;
  recognition = new Ctor();
  recognition.lang = "ru-RU";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  recognition.onstart = () => {
    listening = true;
    setMicUi(true);
    setStatus("Слушаю…");
  };

  recognition.onend = () => {
    listening = false;
    setMicUi(false);
    if (!busy) setStatus("");
  };

  recognition.onerror = (event) => {
    listening = false;
    setMicUi(false);
    const err = event?.error || "error";
    if (err === "not-allowed" || err === "service-not-allowed") {
      setStatus("Нет доступа к микрофону. Разрешите микрофон в браузере.", true);
    } else if (err === "no-speech") {
      setStatus("Речь не распознана. Попробуйте ещё раз.");
    } else if (err !== "aborted") {
      setStatus(`Ошибка распознавания: ${err}`, true);
    }
  };

  recognition.onresult = (event) => {
    const result = event?.results?.[0]?.[0]?.transcript;
    if (result) void handleUserText(result, { fromVoice: true });
  };

  return recognition;
}

function toggleListening() {
  unlockTtsAudio();
  if (busy) return;
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    setStatus("Голосовой ввод не поддерживается в этом браузере. Используйте Chrome или Edge, либо введите текст.", true);
    return;
  }
  const rec = ensureRecognition();
  if (!rec) return;

  if (listening) {
    try {
      rec.stop();
    } catch {
      /* ignore */
    }
    return;
  }

  // Не pause() на ttsAudio сразу после unlock — iOS иначе может не «запомнить» жест.
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
  try {
    rec.start();
  } catch (e) {
    setStatus(e?.message || "Не удалось запустить микрофон", true);
  }
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
      pendingOrderDraft = null;
      stopSpeaking();
      if (feed) {
        feed.innerHTML =
          '<p class="voice-empty">Спросите про заказ голосом или текстом — например: «Какая сумма по последнему заказу?» или «Создай заказ клиенту Иванову на 50 тысяч, адрес Ленина 10».</p>';
      }
      setStatus("");
    });
  }

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
    setStatus("В этом браузере нет распознавания речи — можно писать текстом. Лучше Chrome или Edge.", false);
  }
}

export function onVoiceSectionEnter() {
  const input = document.getElementById("voiceComposerInput");
  input?.focus?.({ preventScroll: true });
}

export function onVoiceSectionLeave() {
  stopSpeaking();
  if (listening && recognition) {
    try {
      recognition.stop();
    } catch {
      /* ignore */
    }
  }
}
