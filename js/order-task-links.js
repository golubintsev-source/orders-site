import { fetchAllSupabaseRows } from "./supabase-fetch.js";
import { buildOrderCellHighlights } from "./order-cell-highlights.js";
import { supabaseClient } from "./config.js";
import { readPendingTasksQueueForMessageLinks } from "./offline-cache.js";
import { isUserAuthorOfTask, isUserExecutorOfTask } from "./task-form-shared.js";
import { taskLinkedOrderIds } from "./task-attachment-data.js";

/** @type {Set<number>} */
const activeTaskOrderIds = new Set();
let cellHighlights = new Map();
let lastTaskRows = [];
let refreshGeneration = 0;

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

function isActiveTaskRow(row) {
  return row && row.is_completed !== true && row.is_completed !== 1 && row.is_completed !== "1";
}

function isMyActiveOrderTask(row) {
  return isActiveTaskRow(row) && (isUserAuthorOfTask(row) || isUserExecutorOfTask(row));
}

function ingestTaskRow(row) {
  if (!isMyActiveOrderTask(row)) return;
  for (const id of taskLinkedOrderIds(row)) activeTaskOrderIds.add(id);
}

export function applyOrderTaskHighlightsInDom(root = document) {
  for (const td of root.querySelectorAll(".td-order-id[data-order-id]")) {
    const id = td.getAttribute("data-order-id");
    const chip = td.querySelector(".order-id-chip");
    if (chip) chip.classList.toggle("order-id-chip--highlight-tasks", orderHasActiveTask(id));
    for (const cell of td.closest("tr").querySelectorAll("td[data-order-field]")) {
      const status = cellHighlights.get(`${Number(id)}:${cell.dataset.orderField}`);
      cell.classList.toggle("order-cell-task-pending", status === "pending");
      cell.classList.toggle("order-cell-task-completed", status === "completed");
    }
  }
}

export async function refreshActiveTaskOrderRefs(root = document) {
  const generation = ++refreshGeneration;
  const { data, error } = await fetchAllSupabaseRows(() => supabaseClient
    .from("order_tasks")
    .select("id, order_id, body, attachments, is_completed, author_login, executor_emails, source_order_field, highlight_order_field")
    .is("deleted_at", null)
    .or("is_completed.eq.false,highlight_order_field.eq.true")
    .order("id", { ascending: true }));
  if (generation !== refreshGeneration) return;

  if (!error && data) lastTaskRows = data;
  const rows = [...lastTaskRows, ...readPendingTasksQueueForMessageLinks()];
  activeTaskOrderIds.clear();
  for (const row of rows) ingestTaskRow(row);
  cellHighlights = buildOrderCellHighlights(rows);

  applyOrderTaskHighlightsInDom(root);
}
