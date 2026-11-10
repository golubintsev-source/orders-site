import { supabaseClient } from "./config.js";
import { READ_TIMEOUT_MS } from "./read-requests.js";

let summaryUnavailable = false;

/** Return null on servers where the migration has not been applied yet. */
export async function readChatSummary({ boot = null, badgeOnly = false, openGroupId = null } = {}) {
  if (summaryUnavailable) return null;
  let result = boot ? await boot : null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
  try {
    if (!result || (result.error && result.error.code !== "PGRST202" && result.error.code !== "42883")) {
      const args = { p_badge_only: badgeOnly };
      if (openGroupId) args.p_open_group = openGroupId;
      result = await supabaseClient.rpc("get_chat_summary", args, { get: true }).abortSignal(controller.signal);
    }
    const { data, error } = result;
    if (error?.code === "PGRST202" || error?.code === "42883") {
      summaryUnavailable = true;
      return null;
    }
    if (error) throw error;
    if (!Array.isArray(data?.dialogs) || !Number.isSafeInteger(data.unread_count) || data.unread_count < 0) {
      throw new Error("Некорректный ответ списка чатов");
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export function paintMessagesNavBadge(count) {
  const badge = document.getElementById("messagesUnreadBadge");
  if (badge) {
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.hidden = count === 0;
  }
  document.getElementById("messagesNavBtn")?.classList.toggle("messages-nav-btn--has-unread", count > 0);
}
