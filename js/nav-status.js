// Shared header status is independent of the task/chat screens and their histories.
import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import { refreshMyTasksNavBadge } from "./task-badge.js";
import { setPushBadgeCount } from "./push-notifications.js";
import { fetchAllSupabaseRows } from "./supabase-fetch.js";
import { conversationPeerFromPushData } from "./messages-sync-utils.js";

let started = false;
let pending = null;

export async function refreshHeaderMessages() {
  if (window.__messagesStatusReady) return;
  const uid = state.currentUser?.id;
  if (!uid) return;
  const dm = await supabaseClient.from("user_messages").select("id", { count: "exact", head: true })
    .eq("recipient_id", uid).is("read_at", null).is("deleted_at", null);
  if (dm.error) throw dm.error;
  const groups = await fetchAllSupabaseRows(() => supabaseClient.from("group_chats")
    .select("id").contains("member_ids", [uid]).order("id", { ascending: true }));
  if (groups.error) throw groups.error;
  let count = dm.count || 0;
  // Count on the server; never download the group message archive for the badge.
  for (let offset = 0; offset < groups.data.length; offset += 3) {
    if (window.__messagesStatusReady || state.currentUser?.id !== uid) return;
    const counts = await Promise.all(groups.data.slice(offset, offset + 3).map(async ({ id }) => {
      const read = await supabaseClient.from("group_chat_reads").select("last_read_at")
        .eq("chat_id", id).eq("user_id", uid).maybeSingle();
      if (read.error) throw read.error;
      let query = supabaseClient.from("group_messages").select("id", { count: "exact", head: true })
        .eq("chat_id", id).neq("sender_id", uid).is("deleted_at", null);
      if (read.data?.last_read_at) query = query.gt("created_at", read.data.last_read_at);
      const result = await query;
      if (result.error) throw result.error;
      return result.count || 0;
    }));
    count += counts.reduce((a, b) => a + b, 0);
  }
  if (window.__messagesStatusReady || state.currentUser?.id !== uid) return;
  const badge = document.getElementById("messagesUnreadBadge");
  const button = document.getElementById("messagesNavBtn");
  if (badge) { badge.textContent = count > 99 ? "99+" : String(count); badge.hidden = count === 0; }
  button?.classList.toggle("messages-nav-btn--has-unread", count > 0);
  await setPushBadgeCount(count);
}

export function refreshNavStatus() {
  if (pending) return pending;
  if (document.visibilityState === "hidden") return Promise.resolve();
  pending = Promise.allSettled([refreshMyTasksNavBadge(), refreshHeaderMessages()])
    .then((results) => {
      for (const result of results) if (result.status === "rejected") console.warn("Статус уведомлений:", result.reason);
    }).finally(() => { pending = null; });
  return pending;
}

export function initNavStatus() {
  if (started) return;
  started = true;
  void refreshNavStatus();
  window.setInterval(() => void refreshNavStatus(), 60_000);
  document.addEventListener("visibilitychange", () => void refreshNavStatus());
  window.addEventListener("online", () => void refreshNavStatus());
  const onPush = (data) => {
    if (window.__messagesStatusReady) return;
    if (data?.type === "open-chat") {
      // A notification click is an explicit request to open the chat screen.
      const peerId = conversationPeerFromPushData(data) || data.peerId || null;
      void import("./messages.js").then((m) => m.openChatFromNotification(peerId)).catch(console.error);
    } else if (data?.type === "push-received") void refreshNavStatus();
  };
  window.addEventListener("orders-sw-message", (event) => onPush(event.detail));
  for (const event of window.__pendingSwMessages || []) if (event?.type === "open-chat") onPush(event);
}
