/**
 * Чистые хелперы синхронизации чатов (прочтение, push, метки времени).
 * Без DOM — покрываются scripts/test-messages-sync.mjs.
 */

/** ISO / timestamptz → миллисекунды; 0 если дата не читается. */
export function timestampMs(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 && value < 1e12 ? value * 1000 : value;
  }
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? t : 0;
}

export function isTimestampAfter(a, b) {
  return timestampMs(a) > timestampMs(b);
}

export function isTimestampSameOrBefore(a, b) {
  return timestampMs(a) <= timestampMs(b);
}

/** Более поздняя из двух ISO-меток; при равенстве по мс сохраняет первую. */
export function laterIsoTimestamp(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return timestampMs(a) >= timestampMs(b) ? String(a) : String(b);
}

export function conversationPeerFromPushData(data) {
  if (!data || typeof data !== "object") return null;
  const peerId = data.peerId != null && String(data.peerId).trim() ? String(data.peerId).trim() : "";
  if (peerId) return peerId;
  const chatId = data.chatId != null && String(data.chatId).trim() ? String(data.chatId).trim() : "";
  if (chatId) return chatId.startsWith("group:") ? chatId : `group:${chatId}`;
  const url = String(data.url || "");
  if (!url) return null;
  try {
    const parsed = new URL(url, "https://placeholder.local");
    const chat = parsed.searchParams.get("chat");
    return chat && chat.trim() ? chat.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Ответ вкладки на запрос видимости считаем действительным всего несколько секунд:
 * push приходит в момент, когда service worker уже опросил живые окна.
 */
export const PUSH_VISIBILITY_ANSWER_MAX_AGE_MS = 3_000;

/**
 * OS-уведомление не показываем, только если пользователь уже смотрит этот диалог
 * (как Telegram/WhatsApp: баннер не нужен, когда переписка на экране).
 * На iOS WindowClient.focused часто врёт — ориентируемся на visibility с клиента.
 * Без живого окна подавлять нельзя: свёрнутое PWA не шлёт visibilitychange,
 * и по устаревшему статусу уведомление пропадало совсем.
 */
export function shouldSuppressPushNotification({
  clientVisible,
  viewingPeerId,
  incomingPeerId,
  stateAgeMs = 0,
  maxStateAgeMs = PUSH_VISIBILITY_ANSWER_MAX_AGE_MS,
  hasLiveClient = true,
} = {}) {
  if (!hasLiveClient) return false;
  if (stateAgeMs > maxStateAgeMs) return false;
  if (!clientVisible) return false;
  if (!incomingPeerId) return false;
  return String(viewingPeerId || "") === String(incomingPeerId);
}

/**
 * Решение по всем окнам сразу. Service worker перед показом push опрашивает клиентов
 * и складывает свежие ответы сюда: замороженная вкладка (iOS PWA в фоне) не отвечает,
 * поэтому уведомление показывается — вместо тишины по последнему известному статусу.
 */
export function resolvePushSuppression({
  incomingPeerId,
  clientStates = [],
  now = Date.now(),
  maxAnswerAgeMs = PUSH_VISIBILITY_ANSWER_MAX_AGE_MS,
} = {}) {
  if (!incomingPeerId) return false;
  for (const state of clientStates) {
    if (
      shouldSuppressPushNotification({
        clientVisible: state?.visible,
        viewingPeerId: state?.peerId,
        incomingPeerId,
        stateAgeMs: now - Number(state?.at || 0),
        maxStateAgeMs: maxAnswerAgeMs,
        hasLiveClient: true,
      })
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Несколько сообщений подряд схлопываются в одно уведомление по tag'у, поэтому
 * к тексту последнего добавляем счётчик пропущенных — как в WhatsApp/Telegram.
 */
export function notificationBodyWithCount(text, count) {
  const body = String(text || "").trim();
  const extra = Math.max(0, Math.floor(Number(count) || 0) - 1);
  if (!extra) return body;
  const suffix = `Ещё ${extra} ${pluralRu(extra, "сообщение", "сообщения", "сообщений")}`;
  return body ? `${body}\n${suffix}` : suffix;
}

function pluralRu(n, one, few, many) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/**
 * Переподключение realtime: экспоненциальная задержка с потолком и джиттером,
 * чтобы все клиенты не ломились в сокет одновременно после аварии сети.
 */
export function nextReconnectDelayMs(attempt, { baseMs = 1_000, maxMs = 30_000, jitter = 0 } = {}) {
  const step = Math.max(0, Math.floor(Number(attempt) || 0));
  const raw = baseMs * 2 ** step;
  const capped = Math.min(raw, maxMs);
  const spread = capped * Math.min(Math.max(jitter, 0), 1);
  return Math.round(capped - spread / 2 + spread * Math.random());
}

/**
 * Догон новых сообщений идёт от времени последнего показанного. Строка может быть
 * зафиксирована в БД позже, чем её created_at (репликация, параллельные транзакции),
 * поэтому окно берём с запасом назад — дубли отсеются по id.
 */
export function pollSinceIso(lastSeenIso, overlapMs = 60_000) {
  const ms = timestampMs(lastSeenIso);
  if (!ms) return null;
  const from = ms - Math.max(0, Number(overlapMs) || 0);
  return new Date(from).toISOString();
}

/**
 * Непрочитанные по группам считаем одним запросом с отсечкой по самой ранней метке
 * прочтения. Если хоть у одного чата метки нет, отсечка обрежет его старые сообщения
 * и счётчик окажется занижен — тогда фильтр не применяем.
 */
export function groupUnreadCutoffIso(chatIds, lastReadByChat) {
  if (!chatIds?.length) return null;
  let min = null;
  for (const chatId of chatIds) {
    const key = String(chatId);
    const lastRead = lastReadByChat?.get?.(key) ?? lastReadByChat?.get?.(chatId);
    if (!lastRead) return null;
    if (!min || timestampMs(lastRead) < timestampMs(min)) min = String(lastRead);
  }
  return min;
}

/**
 * Ленту диалога нужно сбросить, если на экране ещё чужой peer.
 * Иначе при входе в другой чат секунду-две видна предыдущая переписка.
 */
export function shouldResetDialogFeed(renderedPeerId, nextPeerId) {
  return String(renderedPeerId || "") !== String(nextPeerId || "");
}

/**
 * Первый проход списка чатов берёт только недавние DM. Если по нему пересобрать
 * DOM «как есть», более старые диалоги (снимок / полный проход) пропадают,
 * а через 1–2 с появляются снова — на телефоне в PWA это выглядит как мигание.
 * Частичный набор дополняем уже показанными peer'ами, сохраняя порядок новых.
 */
export function mergePartialChatListPeerIds(nextPeerIds, existingPeerIds) {
  const seen = new Set();
  const out = [];
  for (const id of nextPeerIds || []) {
    const peerId = String(id || "");
    if (!peerId || seen.has(peerId)) continue;
    seen.add(peerId);
    out.push(peerId);
  }
  for (const id of existingPeerIds || []) {
    const peerId = String(id || "");
    if (!peerId || seen.has(peerId)) continue;
    seen.add(peerId);
    out.push(peerId);
  }
  return out;
}
