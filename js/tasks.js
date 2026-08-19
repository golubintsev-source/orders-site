import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import {
  formatTaskDateRu,
  formatTaskAuthorShort,
  formatTaskExecutors,
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
} from "./task-form-shared.js";
import {
  persistOrderTasksSnapshot,
  mergeOrderTasksRowsForAllTasks,
  updatePendingTaskCompleted,
} from "./offline-cache.js";
import { fetchAllSupabaseRows } from "./supabase-fetch.js";

const TASK_SELECT_FIELDS =
  "id, created_at, author_login, body, due_at, executor_emails, is_completed";

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

function filterVisibleActiveTasks(rows) {
  return (rows || []).filter((row) => canUserAccessTask(row) && isActiveTask(row));
}

function filterMyExecutorTasks(rows) {
  return (rows || []).filter((row) => isUserExecutorOfTask(row));
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

function setTaskFormDisabled(disabled) {
  const createBtn = document.getElementById("orderTaskCreateBtn");
  const textInput = document.getElementById("orderTaskTextInput");
  const dueInput = document.getElementById("orderTaskDueAtInput");
  const executorsList = document.getElementById("orderTaskExecutorsList");
  if (createBtn) createBtn.disabled = disabled;
  if (textInput) textInput.disabled = disabled;
  if (dueInput) dueInput.disabled = disabled;
  if (executorsList) {
    executorsList.querySelectorAll(".order-tasks-executor-option").forEach((btn) => {
      btn.disabled = disabled;
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

async function ensureOrderTaskExecutorsLoaded() {
  const list = document.getElementById("orderTaskExecutorsList");
  const hint = document.getElementById("orderTaskExecutorsHint");
  await ensureTaskExecutorsInList(list, hint);
}

function renderCompletedCheckboxCell(row) {
  const canToggle = canUserCompleteTask(row);
  const checked = !isActiveTask(row);
  const taskId = row.id != null ? String(row.id) : "";
  const offlineLocalId = row.__offlineLocalId ? String(row.__offlineLocalId) : "";
  return `
    <td class="order-tasks-completed-cell">
      <label class="order-tasks-completed-label">
        <input
          type="checkbox"
          class="order-tasks-completed-cb"
          data-task-id="${escapeHtml(taskId)}"
          data-offline-local-id="${escapeHtml(offlineLocalId)}"
          ${checked ? "checked" : ""}
          ${canToggle ? "" : "disabled"}
        />
        <span class="order-tasks-completed-text">Выполнена</span>
      </label>
    </td>
  `;
}

function renderTaskTableRowCells(row) {
  const executors = formatTaskExecutors(normalizeExecutorEmails(row.executor_emails), displayNameByEmail);
  const due = row.due_at ? formatTaskDateRu(row.due_at) : "—";
  return `
      <td>${escapeHtml(formatTaskDateRu(row.created_at))}</td>
      <td>${escapeHtml(formatTaskAuthorShort(row.author_login))}</td>
      <td class="order-tasks-executors-cell">${escapeHtml(executors)}</td>
      <td>${escapeHtml(due)}</td>
      <td class="order-tasks-text-cell">${escapeHtml(row.body || "")}</td>
      ${renderCompletedCheckboxCell(row)}
  `;
}

async function fetchActiveTasksFromServer() {
  const { data, error } = await fetchAllSupabaseRows(() =>
    supabaseClient
      .from("order_tasks")
      .select(TASK_SELECT_FIELDS)
      .eq("is_completed", false)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }),
  );
  return { data, error };
}

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

  await loadOrderTasks();
  void loadAllTasks();
  void refreshMyTasksNavBadge();
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
  const tbody = document.querySelector("#allTasksTable tbody");
  const msg = document.getElementById("allTasksMessage");
  if (!tbody) return;
  if (msg) {
    msg.textContent = "";
    msg.classList.remove("order-tasks-message--error");
  }

  if (!state.currentUser) {
    tbody.innerHTML = "";
    if (msg) msg.textContent = "Войдите в систему, чтобы видеть задачи.";
    return;
  }

  const { data, error } = await fetchAllTasksFromServer();

  if (error) {
    console.error("Ошибка загрузки задач:", error);
    if (msg) {
      msg.textContent = "Ошибка загрузки задач.";
      msg.classList.add("order-tasks-message--error");
    }
    tbody.innerHTML = "";
    return;
  }

  const baseRows = data || [];
  if (!error && data) persistOrderTasksSnapshot(data);

  const rows = sortTasksByDueAt(filterMyExecutorTasks(mergeOrderTasksRowsForAllTasks(baseRows)));
  tbody.innerHTML = rows.map((row) => renderMyTasksRow(row)).join("");

  if (rows.length === 0 && msg) {
    msg.textContent = "Нет задач, где вы исполнитель.";
  }

  void refreshMyTasksNavBadge();
}

export async function loadOrderTasks() {
  const tbody = document.querySelector("#orderTasksTable tbody");
  const msg = document.getElementById("orderTasksMessage");
  if (!tbody) return;

  void ensureOrderTaskExecutorsLoaded();

  if (!state.currentUser) {
    tbody.innerHTML = "";
    setTaskFormDisabled(true);
    if (msg) {
      msg.textContent = "Войдите в систему, чтобы работать с задачами.";
      msg.classList.remove("order-tasks-message--error");
    }
    return;
  }

  setTaskFormDisabled(false);
  if (!document.getElementById("orderTaskDueAtInput")?.value) {
    resetTaskFormDefaults();
  }

  if (msg) msg.textContent = "";

  const { data, error } = await fetchActiveTasksFromServer();

  if (error) {
    console.error("Ошибка загрузки задач:", error);
    if (msg) {
      msg.textContent = "Ошибка загрузки задач.";
      msg.classList.add("order-tasks-message--error");
    }
    tbody.innerHTML = "";
    return;
  }

  if (msg) msg.classList.remove("order-tasks-message--error");

  const rows = filterVisibleActiveTasks(mergeOrderTasksRowsForAllTasks(data || []));
  tbody.innerHTML = rows
    .map(
      (row) => `
    <tr class="${row.__offlinePendingSync ? "tr-order-offline-pending" : ""}">
      ${renderTaskTableRowCells(row)}
    </tr>
  `,
    )
    .join("");

  if (rows.length === 0 && msg) {
    msg.textContent = "Нет актуальных задач.";
  }
}

export async function createOrderTask() {
  const input = document.getElementById("orderTaskTextInput");
  const dueInput = document.getElementById("orderTaskDueAtInput");
  const msg = document.getElementById("orderTasksMessage");
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
  await loadOrderTasks();
  void loadAllTasks();
  void refreshMyTasksNavBadge();
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
  const myTasksNavBtn = document.getElementById("myTasksNavBtn");
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
  if (myTasksNavBtn) {
    myTasksNavBtn.addEventListener("click", () => {
      void import("./section-nav.js").then((m) => m.switchSection("tasks-all"));
    });
  }

  void ensureOrderTaskExecutorsLoaded();
  startMyTasksBadgePolling();

  bindTaskCompletedCheckboxDelegation(document.getElementById("orderTasksTable"));
  bindTaskCompletedCheckboxDelegation(document.getElementById("allTasksTable"));
}
