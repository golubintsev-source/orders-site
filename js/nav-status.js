// Shared header status is independent of the task/chat screens and their histories.
import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import { refreshMyTasksNavBadge } from "./task-badge.js";
import { setPushBadgeCount } from "./push-notifications.js";
import { fetchAllSupabaseRows } from "./supabase-fetch.js";
import { conversationPeerFromPushData } from "./messages-sync-utils.js";

let started = false;
let taskPending = null;
let messagePending = null;
let taskRefreshTimer = null;
let messageRefreshTimer = null;
let navStatusChannel = null;
let navStatusRealtimeUid = null;

const NAV_STATUS_FALLBACK_MS = 10 * 60_000;
const NAV_STATUS_EVENT_DEBOUNCE_MS = 300;

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

function refreshTaskStatus() {
  if (taskPending) return taskPending;
  if (document.visibilityState === "hidden") return Promise.resolve();
  const current = Promise.resolve(refreshMyTasksNavBadge()).catch((error) => {
    console.warn("Статус задач:", error);
  });
  taskPending = current;
  return current.finally(() => { if (taskPending === current) taskPending = null; });
}

function refreshMessageStatus() {
  if (messagePending) return messagePending;
  if (document.visibilityState === "hidden") return Promise.resolve();
  const current = Promise.resolve(refreshHeaderMessages()).catch((error) => {
    console.warn("Статус сообщений:", error);
  });
  messagePending = current;
  return current.finally(() => { if (messagePending === current) messagePending = null; });
}

export function refreshNavStatus() {
  return Promise.allSettled([refreshTaskStatus(), refreshMessageStatus()]);
}

function scheduleTaskStatusRefresh() {
  if (taskRefreshTimer) window.clearTimeout(taskRefreshTimer);
  taskRefreshTimer = window.setTimeout(() => {
    taskRefreshTimer = null;
    void refreshTaskStatus();
  }, NAV_STATUS_EVENT_DEBOUNCE_MS);
}

function scheduleMessageStatusRefresh() {
  if (messageRefreshTimer) window.clearTimeout(messageRefreshTimer);
  messageRefreshTimer = window.setTimeout(() => {
    messageRefreshTimer = null;
    void refreshMessageStatus();
  }, NAV_STATUS_EVENT_DEBOUNCE_MS);
}

function stopNavStatusRealtime() {
  if (!navStatusChannel) return;
  const channel = navStatusChannel;
  navStatusChannel = null;
  navStatusRealtimeUid = null;
  void supabaseClient.removeChannel(channel);
}

function startNavStatusRealtime() {
  const uid = state.currentUser?.id;
  if (!uid) return;
  if (navStatusChannel && navStatusRealtimeUid === String(uid)) return;
  if (navStatusChannel) stopNavStatusRealtime();

  navStatusRealtimeUid = String(uid);
  navStatusChannel = supabaseClient
    .channel(`nav-status:${uid}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "order_tasks" },
      scheduleTaskStatusRefresh,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "user_messages", filter: `recipient_id=eq.${uid}` },
      scheduleMessageStatusRefresh,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "group_messages" },
      scheduleMessageStatusRefresh,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "group_chat_reads" },
      scheduleMessageStatusRefresh,
    )
    .subscribe();
}

export function initNavStatus() {
  if (started) return;
  started = true;
  void refreshNavStatus();
  startNavStatusRealtime();
  // Realtime — основной путь. Редкий проход нужен только как страховка после
  // потери сети, сна iOS/PWA или незаметного разрыва WebSocket.
  window.setInterval(() => void refreshNavStatus(), NAV_STATUS_FALLBACK_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    startNavStatusRealtime();
    void refreshNavStatus();
  });
  window.addEventListener("online", () => {
    startNavStatusRealtime();
    void refreshNavStatus();
  });
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) stopNavStatusRealtime();
  });
  const onPush = (data) => {
    if (window.__messagesStatusReady) return;
    if (data?.type === "open-chat") {
      // A notification click is an explicit request to open the chat screen.
      const peerId = conversationPeerFromPushData(data) || data.peerId || null;
      void import("./messages.js").then((m) => m.openChatFromNotification(peerId)).catch(console.error);
    } else if (data?.type === "push-received") scheduleMessageStatusRefresh();
  };
  window.addEventListener("orders-sw-message", (event) => onPush(event.detail));
  for (const event of window.__pendingSwMessages || []) if (event?.type === "open-chat") onPush(event);
}

