import { supabaseClient } from "./config.js";
import { readPendingTasksQueueForMessageLinks } from "./offline-cache.js";

/** @type {Set<string>} */
const activeTaskMessageRefs = new Set();

export function messageTaskRef(kind, messageId) {
  if (messageId == null || messageId === "") return "";
  const k = String(kind || "user").trim() || "user";
  return `${k}:${String(messageId)}`;
}

export function messageHasActiveTask(kind, messageId) {
  const ref = messageTaskRef(kind, messageId);
  return ref ? activeTaskMessageRefs.has(ref) : false;
}

export function addActiveTaskMessageRef(kind, messageId) {
  const ref = messageTaskRef(kind, messageId);
  if (ref) activeTaskMessageRefs.add(ref);
}

export function removeActiveTaskMessageRef(kind, messageId) {
  const ref = messageTaskRef(kind, messageId);
  if (ref) activeTaskMessageRefs.delete(ref);
}

function ingestTaskRow(row) {
  if (!row || row.is_completed === true || row.is_completed === 1 || row.is_completed === "1") {
    return;
  }
  if (row.source_message_id == null) return;
  const ref = messageTaskRef(row.source_message_kind || "user", row.source_message_id);
  if (ref) activeTaskMessageRefs.add(ref);
}

export function applyMessageTaskHighlightsInFeed(feed = document.getElementById("messagesFeed")) {
  if (!feed) return;
  for (const el of feed.querySelectorAll(".message-item[data-message-id]")) {
    const id = el.getAttribute("data-message-id");
    const kind = el.getAttribute("data-message-kind") || "user";
    el.classList.toggle("message-item--has-active-task", messageHasActiveTask(kind, id));
  }
}

export async function refreshActiveTaskMessageRefs() {
  activeTaskMessageRefs.clear();

  const { data, error } = await supabaseClient
    .from("order_tasks")
    .select("source_message_id, source_message_kind, is_completed")
    .not("source_message_id", "is", null)
    .eq("is_completed", false)
    .is("deleted_at", null);

  if (!error && data) {
    for (const row of data) ingestTaskRow(row);
  }

  for (const row of readPendingTasksQueueForMessageLinks()) {
    ingestTaskRow(row);
  }

  applyMessageTaskHighlightsInFeed();
}
