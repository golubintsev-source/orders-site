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
 * OS-уведомление не показываем, только если пользователь уже смотрит этот диалог
 * (как Telegram/WhatsApp: баннер не нужен, когда переписка на экране).
 * На iOS WindowClient.focused часто врёт — ориентируемся на visibility с клиента.
 */
export function shouldSuppressPushNotification({
  clientVisible,
  viewingPeerId,
  incomingPeerId,
  stateAgeMs = 0,
  maxStateAgeMs = 90_000,
} = {}) {
  if (stateAgeMs > maxStateAgeMs) return false;
  if (!clientVisible) return false;
  if (!incomingPeerId) return false;
  return String(viewingPeerId || "") === String(incomingPeerId);
}

/**
 * Ленту диалога нужно сбросить, если на экране ещё чужой peer.
 * Иначе при входе в другой чат секунду-две видна предыдущая переписка.
 */
export function shouldResetDialogFeed(renderedPeerId, nextPeerId) {
  return String(renderedPeerId || "") !== String(nextPeerId || "");
}
