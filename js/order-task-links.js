import { supabaseClient } from "./config.js";
import { readPendingTasksQueueForMessageLinks } from "./offline-cache.js";

/** @type {Set<number>} */
const activeTaskOrderIds = new Set();

export function orderHasActiveTask(orderId) {
  const id = Number(orderId);
  return Number.isFinite(id) && id > 0 && activeTaskOrderIds.has(id);
}

export function addActiveTaskOrderRef(orderId) {
  const id = Number(orderId);
  if (Number.isFinite(id) && id > 0) activeTaskOrderIds.add(id);
}

export function removeActiveTaskOrderRef(orderId) {
  const id = Number(orderId);
  if (Number.isFinite(id) && id > 0) activeTaskOrderIds.delete(id);
}

function ingestTaskRow(row) {
  if (!row || row.is_completed === true || row.is_completed === 1 || row.is_completed === "1") {
    return;
  }
  const id = Number(row.order_id);
  if (!Number.isFinite(id) || id <= 0) return;
  activeTaskOrderIds.add(id);
}

export function applyOrderTaskHighlightsInDom(root = document) {
  for (const td of root.querySelectorAll(".td-order-id[data-order-id]")) {
    const id = td.getAttribute("data-order-id");
    const chip = td.querySelector(".order-id-chip");
    if (!chip) continue;
    chip.classList.toggle("order-id-chip--highlight-tasks", orderHasActiveTask(id));
  }
}

export async function refreshActiveTaskOrderRefs(root = document) {
  activeTaskOrderIds.clear();

  const { data, error } = await supabaseClient
    .from("order_tasks")
    .select("order_id, is_completed")
    .not("order_id", "is", null)
    .eq("is_completed", false);

  if (!error && data) {
    for (const row of data) ingestTaskRow(row);
  }

  for (const row of readPendingTasksQueueForMessageLinks()) {
    ingestTaskRow(row);
  }

  applyOrderTaskHighlightsInDom(root);
}
