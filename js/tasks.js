import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import {
  formatTaskDateRu,
  formatTaskExecutors,
  formatOrderIdTypeChip,
} from "./format.js";
import { displayNameByEmail } from "./user-names.js";
import {
  defaultTaskDueAtLocal,
  datetimeLocalToIso,
  ensureTaskExecutorsInList,
  getSelectedExecutorEmailsFrom,
  insertTask,
  resetTaskExecutorsList,
  canUserAccessTask,
  canUserCompleteTask,
  normalizeExecutorEmails,
  isUserExecutorOfTask,
  isUserAuthorOfTask,
} from "./task-form-shared.js";
import {
  persistOrderTasksSnapshot,
  mergeOrderTasksRowsForAllTasks,
  mergeOrderTasksRowsForOrder,
  updatePendingTaskCompleted,
} from "./offline-cache.js";
import { fetchAllSupabaseRows } from "./supabase-fetch.js";

const TASK_SELECT_FIELDS =
  "id, created_at, author_login, body, due_at, executor_emails, is_completed, order_id";

function escapeHtml(s) {
  if (s == null) return "";
  const div = document.createElement("div");
  div.textContent = String(s);
  return div.innerHTML;
}

export { canUserAccessTask } from "./task-form-shared.js";

function isActiveTask(row) {
  return row.is_completed !== true && row.is_completed !== 1 && row.is_completed !== "1";
}

function filterMyExecutorTasks(rows) {
  return (rows || []).filter((row) => isUserExecutorOfTask(row));
}

function filterMyAuthorTasks(rows) {
  return (rows || []).filter((row) => isUserAuthorOfTask(row));
}

function isStandaloneTask(row) {
  const id = row?.order_id;
  return id == null || id === "" || !Number.isFinite(Number(id)) || Number(id) <= 0;
}

function filterStandaloneTasks(rows) {
  return (rows || []).filter((row) => isStandaloneTask(row));
}

function filterTasksForOrder(rows, orderId) {
  const oid = Number(orderId);
  if (!Number.isFinite(oid) || oid <= 0) return [];
  return (rows || []).filter((row) => Number(row.order_id) === oid);
}

function sortTasksByDueAt(rows) {
  return [...rows].sort((a, b) => {
    const ta = a.due_at ? new Date(a.due_at).getTime() : Number.POSITIVE_INFINITY;
    const tb = b.due_at ? new Date(b.due_at).getTime() : Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    const ca = new Date(a.created_at || 0).getTime();
    const cb = new Date(b.created_at || 0).getTime();
    return cb - ca;
  });
}

function renderMyTaskStatusCell(row) {
  const completed = !isActiveTask(row);
  const statusText = completed ? "Выполнена" : "Не выполнена";
  const canToggle = canUserCompleteTask(row);
  const taskId = row.id != null ? String(row.id) : "";
  const offlineLocalId = row.__offlineLocalId ? String(row.__offlineLocalId) : "";
  const checkboxHtml = canToggle
    ? `
      <label class="my-tasks-status-toggle" title="Отметить выполнение">
        <input
          type="checkbox"
          class="order-tasks-completed-cb"
          data-task-id="${escapeHtml(taskId)}"
          data-offline-local-id="${escapeHtml(offlineLocalId)}"
          ${completed ? "checked" : ""}
        />
      </label>
    `
    : "";
  return `
    <td class="my-tasks-status-cell">
      <span class="my-tasks-status-text">${escapeHtml(statusText)}</span>
      ${checkboxHtml}
    </td>
  `;
}

function renderMyAuthorTasksRow(row) {
  const completed = !isActiveTask(row);
  const offlineCls = row.__offlinePendingSync ? " tr-order-offline-pending" : "";
  const rowClass = completed
    ? `my-tasks-row my-tasks-row--completed${offlineCls}`
    : `my-tasks-row my-tasks-row--pending${offlineCls}`;
  const executors = formatTaskExecutors(normalizeExecutorEmails(row.executor_emails), displayNameByEmail);
  const due = row.due_at ? formatTaskDateRu(row.due_at) : "—";
  return `
    <tr class="${rowClass}">
      <td class="order-tasks-executors-cell">${escapeHtml(executors)}</td>
      <td>${escapeHtml(due)}</td>
      ${renderMyTaskStatusCell(row)}
      <td class="order-tasks-text-cell">${escapeHtml(row.body || "")}</td>
    </tr>
  `;
}

function formatTaskAuthorName(raw) {
  if (raw == null || raw === "") return "—";
  const name = displayNameByEmail(String(raw).trim());
  return name || "—";
}

function renderMyTasksRow(row) {
  const completed = !isActiveTask(row);
  const offlineCls = row.__offlinePendingSync ? " tr-order-offline-pending" : "";
  const rowClass = completed
    ? `my-tasks-row my-tasks-row--completed${offlineCls}`
    : `my-tasks-row my-tasks-row--pending${offlineCls}`;
  const executors = formatTaskExecutors(normalizeExecutorEmails(row.executor_emails), displayNameByEmail);
  const due = row.due_at ? formatTaskDateRu(row.due_at) : "—";
  return `
    <tr class="${rowClass}">
      <td>${escapeHtml(formatTaskAuthorName(row.author_login))}</td>
      <td class="order-tasks-executors-cell">${escapeHtml(executors)}</td>
      <td>${escapeHtml(due)}</td>
      ${renderMyTaskStatusCell(row)}
      <td class="order-tasks-text-cell">${escapeHtml(row.body || "")}</td>
    </tr>
  `;
}

async function fetchAllTasksFromServer() {
  const { data, error } = await fetchAllSupabaseRows(() =>
    supabaseClient.from("order_tasks").select(TASK_SELECT_FIELDS),
  );
  return { data, error };
}

async function fetchTasksForOrderFromServer(orderId) {
  const oid = Number(orderId);
  if (!Number.isFinite(oid) || oid <= 0) {
    return { data: [], error: null };
  }
  const { data, error } = await fetchAllSupabaseRows(() =>
    supabaseClient.from("order_tasks").select(TASK_SELECT_FIELDS).eq("order_id", oid),
  );
  return { data, error };
}

function setOrderTasksPageTitle(orderId) {
  const titleEl = document.getElementById("orderTasksPageTitle");
  if (!titleEl) return;
  const oid = Number(orderId);
  if (!Number.isFinite(oid) || oid <= 0) {
    titleEl.textContent = "Задачи заказа";
    return;
  }
  const order = state.allOrders?.find((o) => Number(o.id) === oid);
  const chip = formatOrderIdTypeChip(oid, order?.order_type) || `#${oid}`;
  titleEl.textContent = `Задачи заказа ${chip}`;
}

function renderOrderTasksTables(merged, orderId, { executorMsg, authorMsg, executorTbody, authorTbody }) {
  const forOrder = filterTasksForOrder(merged, orderId);
  const executorRows = sortTasksByDueAt(filterMyExecutorTasks(forOrder));
  const authorRows = sortTasksByDueAt(filterMyAuthorTasks(forOrder));

  executorTbody.innerHTML = executorRows.map((row) => renderMyTasksRow(row)).join("");
  authorTbody.innerHTML = authorRows.map((row) => renderMyAuthorTasksRow(row)).join("");

  if (executorMsg) {
    executorMsg.textContent =
      executorRows.length === 0 ? "Нет задач по этому заказу, где вы исполнитель." : "";
  }
  if (authorMsg) {
    authorMsg.textContent = authorRows.length === 0 ? "Нет задач по этому заказу, где вы автор." : "";
  }
}

function setTaskFormDisabled(disabled) {
  const createBtn = document.getElementById("orderTaskCreateBtn");
  const textInput = document.getElementById("orderTaskTextInput");
  const dueInput = document.getElementById("orderTaskDueAtInput");
  const executorsList = document.getElementById("orderTaskExecutorsList");
  if (createBtn) createBtn.disabled = disabled;
  if (textInput) textInput.disabled = disabled;
  if (dueInput) dueInput.disabled = disabled;
  if (executorsList) {
    executorsList.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.disabled = disabled;
    });
  }
}

function resetTaskFormDefaults() {
  const dueInput = document.getElementById("orderTaskDueAtInput");
  if (dueInput && !dueInput.disabled) {
    dueInput.value = defaultTaskDueAtLocal();
  }
  resetTaskExecutorsList(document.getElementById("orderTaskExecutorsList"));
}

function getSelectedExecutorEmails() {
  return getSelectedExecutorEmailsFrom(document.getElementById("orderTaskExecutorsList"));
}

async function ensureMyTasksExecutorsLoaded() {
  const list = document.getElementById("orderTaskExecutorsList");
  const hint = document.getElementById("orderTaskExecutorsHint");
  await ensureTaskExecutorsInList(list, hint);
}

export { ensureMyTasksExecutorsLoaded as ensureOrderTaskExecutorsLoaded };

async function setTaskCompleted(taskId, offlineLocalId, completed) {
  if (offlineLocalId) {
    updatePendingTaskCompleted(offlineLocalId, completed);
    return { error: null };
  }
  if (taskId == null || taskId === "") return { error: new Error("missing task id") };
  return supabaseClient.from("order_tasks").update({ is_completed: completed }).eq("id", taskId);
}

async function onTaskCompletedCheckboxChange(checkbox) {
  if (!checkbox || checkbox.disabled) return;
  const taskId = checkbox.getAttribute("data-task-id");
  const offlineLocalId = checkbox.getAttribute("data-offline-local-id");
  const completed = checkbox.checked;
  checkbox.disabled = true;

  const { error } = await setTaskCompleted(taskId, offlineLocalId || null, completed);
  if (error) {
    console.error("Ошибка обновления статуса задачи:", error);
    checkbox.checked = !completed;
    checkbox.disabled = false;
    return;
  }

  await loadAllTasks();
  void loadOrderTasks();
  void refreshMyTasksNavBadge();
  void import("./message-task-links.js").then((m) => m.refreshActiveTaskMessageRefs());
  void import("./order-task-links.js").then((m) => m.refreshActiveTaskOrderRefs());
}

function bindTaskCompletedCheckboxDelegation(root) {
  if (!root || root.dataset.taskCompletedBound === "1") return;
  root.dataset.taskCompletedBound = "1";
  root.addEventListener("change", (e) => {
    const cb = e.target.closest(".order-tasks-completed-cb");
    if (!cb || !root.contains(cb)) return;
    void onTaskCompletedCheckboxChange(cb);
  });
}

export async function loadAllTasks() {
  const executorTbody = document.querySelector("#allTasksTable tbody");
  const authorTbody = document.querySelector("#myAuthorTasksTable tbody");
  const executorMsg = document.getElementById("allTasksMessage");
  const authorMsg = document.getElementById("myAuthorTasksMessage");
  if (!executorTbody || !authorTbody) return;

  void ensureMyTasksExecutorsLoaded();

  for (const msg of [executorMsg, authorMsg]) {
    if (msg) {
      msg.textContent = "";
      msg.classList.remove("order-tasks-message--error");
    }
  }

  if (!state.currentUser) {
    executorTbody.innerHTML = "";
    authorTbody.innerHTML = "";
    setTaskFormDisabled(true);
    if (executorMsg) executorMsg.textContent = "Войдите в систему, чтобы видеть задачи.";
    return;
  }

  setTaskFormDisabled(false);
  if (!document.getElementById("orderTaskDueAtInput")?.value) {
    resetTaskFormDefaults();
  }

  const { data, error } = await fetchAllTasksFromServer();

  if (error) {
    console.error("Ошибка загрузки задач:", error);
    const errText = "Ошибка загрузки задач.";
    if (executorMsg) {
      executorMsg.textContent = errText;
      executorMsg.classList.add("order-tasks-message--error");
    }
    if (authorMsg) {
      authorMsg.textContent = errText;
      authorMsg.classList.add("order-tasks-message--error");
    }
    executorTbody.innerHTML = "";
    authorTbody.innerHTML = "";
    return;
  }

  const baseRows = data || [];
  if (!error && data) persistOrderTasksSnapshot(data);

  const merged = filterStandaloneTasks(mergeOrderTasksRowsForAllTasks(baseRows));
  const executorRows = sortTasksByDueAt(filterMyExecutorTasks(merged));
  const authorRows = sortTasksByDueAt(filterMyAuthorTasks(merged));

  executorTbody.innerHTML = executorRows.map((row) => renderMyTasksRow(row)).join("");
  authorTbody.innerHTML = authorRows.map((row) => renderMyAuthorTasksRow(row)).join("");

  if (executorRows.length === 0 && executorMsg) {
    executorMsg.textContent = "Нет задач без привязки к заказу, где вы исполнитель.";
  }
  if (authorRows.length === 0 && authorMsg) {
    authorMsg.textContent = "Нет задач без привязки к заказу, где вы автор.";
  }

  void refreshMyTasksNavBadge();
}

export async function loadOrderTasks() {
  const executorTbody = document.querySelector("#orderTasksExecutorTable tbody");
  const authorTbody = document.querySelector("#orderTasksAuthorTable tbody");
  const executorMsg = document.getElementById("orderTasksExecutorMessage");
  const authorMsg = document.getElementById("orderTasksAuthorMessage");
  if (!executorTbody || !authorTbody) return;

  const orderId = state.tasksOrderId;
  setOrderTasksPageTitle(orderId);

  for (const msg of [executorMsg, authorMsg]) {
    if (msg) {
      msg.textContent = "";
      msg.classList.remove("order-tasks-message--error");
    }
  }

  if (!state.currentUser) {
    executorTbody.innerHTML = "";
    authorTbody.innerHTML = "";
    const text = "Войдите в систему, чтобы видеть задачи.";
    if (executorMsg) executorMsg.textContent = text;
    return;
  }

  const oid = Number(orderId);
  if (!Number.isFinite(oid) || oid <= 0) {
    executorTbody.innerHTML = "";
    authorTbody.innerHTML = "";
    const text = "Откройте задачи через меню номера заказа.";
    if (executorMsg) executorMsg.textContent = text;
    return;
  }

  const { data, error } = await fetchTasksForOrderFromServer(oid);

  if (error) {
    console.error("Ошибка загрузки задач заказа:", error);
    const errText = "Ошибка загрузки задач.";
    if (executorMsg) {
      executorMsg.textContent = errText;
      executorMsg.classList.add("order-tasks-message--error");
    }
    if (authorMsg) {
      authorMsg.textContent = errText;
      authorMsg.classList.add("order-tasks-message--error");
    }
    executorTbody.innerHTML = "";
    authorTbody.innerHTML = "";
    return;
  }

  const merged = mergeOrderTasksRowsForOrder(data || [], oid);
  renderOrderTasksTables(merged, oid, {
    executorTbody,
    authorTbody,
    executorMsg,
    authorMsg,
  });

  void refreshMyTasksNavBadge();
}

export async function createOrderTask() {
  const input = document.getElementById("orderTaskTextInput");
  const dueInput = document.getElementById("orderTaskDueAtInput");
  const msg = document.getElementById("myTasksFormMessage");
  if (!input || !state.currentUser) return;

  const text = (input.value || "").trim();
  if (!text) {
    if (msg) {
      msg.textContent = "Введите текст задачи.";
      msg.classList.add("order-tasks-message--error");
    }
    return;
  }

  const executorEmails = getSelectedExecutorEmails();
  const dueAt = datetimeLocalToIso(dueInput?.value);
  const { error } = await insertTask({ body: text, executorEmails, dueAt });

  if (error) {
    console.error("Ошибка создания задачи:", error);
    if (msg) {
      msg.textContent = "Не удалось сохранить задачу.";
      msg.classList.add("order-tasks-message--error");
    }
    return;
  }

  input.value = "";
  resetTaskFormDefaults();
  if (msg) {
    msg.textContent = "";
    msg.classList.remove("order-tasks-message--error");
  }
  await loadAllTasks();
  void loadOrderTasks();
  void refreshMyTasksNavBadge();
  void import("./message-task-links.js").then((m) => m.refreshActiveTaskMessageRefs());
  void import("./order-task-links.js").then((m) => m.refreshActiveTaskOrderRefs());
}

const MY_TASKS_BADGE_POLL_MS = 60_000;
let myTasksBadgePollTimer = null;

function countMyPendingExecutorTasks(rows) {
  return (rows || []).filter((row) => isUserExecutorOfTask(row) && isActiveTask(row)).length;
}

export async function refreshMyTasksNavBadge() {
  const badge = document.getElementById("myTasksPendingBadge");
  const btn = document.getElementById("myTasksNavBtn");
  if (!badge || !btn) return;

  if (!state.currentUser) {
    badge.hidden = true;
    btn.classList.remove("my-tasks-nav-btn--has-pending");
    return;
  }

  const { data, error } = await supabaseClient
    .from("order_tasks")
    .select("id, executor_emails, is_completed, created_at")
    .eq("is_completed", false);

  if (error) {
    console.warn("Не удалось получить число невыполненных задач:", error);
    badge.hidden = true;
    btn.classList.remove("my-tasks-nav-btn--has-pending");
    return;
  }

  const n = countMyPendingExecutorTasks(mergeOrderTasksRowsForAllTasks(data || []));
  if (n > 0) {
    badge.textContent = n > 99 ? "99+" : String(n);
    badge.hidden = false;
    btn.classList.add("my-tasks-nav-btn--has-pending");
  } else {
    badge.hidden = true;
    btn.classList.remove("my-tasks-nav-btn--has-pending");
  }
}

function startMyTasksBadgePolling() {
  if (myTasksBadgePollTimer) return;
  void refreshMyTasksNavBadge();
  myTasksBadgePollTimer = window.setInterval(() => {
    void refreshMyTasksNavBadge();
  }, MY_TASKS_BADGE_POLL_MS);
}

let orderTasksSectionInited = false;

export function initOrderTasksSection() {
  if (orderTasksSectionInited) return;
  orderTasksSectionInited = true;
  const createBtn = document.getElementById("orderTaskCreateBtn");
  const input = document.getElementById("orderTaskTextInput");
  if (createBtn) {
    createBtn.addEventListener("click", () => void createOrderTask());
  }
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void createOrderTask();
      }
    });
  }
  // Клик по #myTasksNavBtn — в initSectionNavDropdown (ранний путь шапки).

  void ensureMyTasksExecutorsLoaded();
  startMyTasksBadgePolling();
  void import("./order-task-links.js").then((m) => m.refreshActiveTaskOrderRefs());

  bindTaskCompletedCheckboxDelegation(document.getElementById("orderTasksExecutorTable"));
  bindTaskCompletedCheckboxDelegation(document.getElementById("orderTasksAuthorTable"));
  bindTaskCompletedCheckboxDelegation(document.getElementById("allTasksTable"));
  bindTaskCompletedCheckboxDelegation(document.getElementById("myAuthorTasksTable"));
}
