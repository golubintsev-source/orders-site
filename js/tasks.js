import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import {
  formatTaskDateRu,
  formatTaskAuthorShort,
  formatTaskExecutors,
} from "./format.js";
import { displayNameByEmail } from "./user-names.js";
import { loadUsersDirectory } from "./users-directory.js";
import {
  persistOrderTasksSnapshot,
  mergeOrderTasksRowsForAllTasks,
  addPendingOfflineTask,
  updatePendingTaskCompleted,
  nextOfflineTempTaskId,
  isOfflineDataMode,
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

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toDatetimeLocalValue(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function defaultTaskDueAtLocal() {
  const d = new Date();
  d.setHours(d.getHours() + 3);
  return toDatetimeLocalValue(d);
}

function datetimeLocalToIso(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function normalizeExecutorEmails(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((e) => String(e || "").trim()).filter(Boolean);
  }
  return [];
}

function getCurrentUserEmail() {
  return (state.currentUser?.email || "").trim().toLowerCase();
}

function getAuthorLogin() {
  const u = state.currentUser;
  if (!u) return "—";
  const email = (u.email || "").trim();
  if (email) return email;
  const meta = u.user_metadata || {};
  if (meta.preferred_username) return String(meta.preferred_username).trim();
  if (meta.name) return String(meta.name).trim();
  return String(u.id || "—");
}

/** Задача доступна только автору или исполнителю. */
export function canUserAccessTask(row) {
  const email = getCurrentUserEmail();
  if (!email || !row) return false;
  const author = String(row.author_login || "").trim().toLowerCase();
  if (author === email) return true;
  const executors = normalizeExecutorEmails(row.executor_emails).map((e) => e.toLowerCase());
  return executors.includes(email);
}

function isActiveTask(row) {
  return row.is_completed !== true && row.is_completed !== 1 && row.is_completed !== "1";
}

function filterVisibleActiveTasks(rows) {
  return (rows || []).filter((row) => canUserAccessTask(row) && isActiveTask(row));
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
  const list = document.getElementById("orderTaskExecutorsList");
  if (list) {
    list.querySelectorAll(".order-tasks-executor-option").forEach((btn) => {
      btn.setAttribute("aria-checked", "false");
      const mark = btn.querySelector(".order-tasks-executor-checkbox");
      if (mark) mark.classList.remove("order-tasks-executor-checkbox--checked");
    });
  }
}

function getSelectedExecutorEmails() {
  const list = document.getElementById("orderTaskExecutorsList");
  if (!list) return [];
  const emails = [];
  list.querySelectorAll(".order-tasks-executor-option[aria-checked='true']").forEach((btn) => {
    const email = btn.getAttribute("data-email");
    if (email) emails.push(email);
  });
  return emails;
}

function renderOrderTaskExecutorsList(users) {
  const list = document.getElementById("orderTaskExecutorsList");
  const hint = document.getElementById("orderTaskExecutorsHint");
  if (!list) return;

  if (!users.length) {
    list.innerHTML = "";
    if (hint) {
      hint.textContent = "Нет пользователей для выбора.";
      hint.hidden = false;
    }
    return;
  }

  if (hint) hint.hidden = true;

  list.innerHTML = users
    .map(
      (user) => `
    <button
      type="button"
      class="order-tasks-executor-option"
      role="checkbox"
      aria-checked="false"
      data-email="${escapeHtml(user.email)}"
    >
      <span class="order-tasks-executor-checkbox" aria-hidden="true"></span>
      <span class="order-tasks-executor-name">${escapeHtml(displayNameByEmail(user.email))}</span>
    </button>
  `,
    )
    .join("");

  list.querySelectorAll(".order-tasks-executor-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      const on = btn.getAttribute("aria-checked") !== "true";
      btn.setAttribute("aria-checked", on ? "true" : "false");
      const mark = btn.querySelector(".order-tasks-executor-checkbox");
      if (mark) mark.classList.toggle("order-tasks-executor-checkbox--checked", on);
    });
  });
}

async function ensureOrderTaskExecutorsLoaded() {
  const list = document.getElementById("orderTaskExecutorsList");
  if (!list || list.dataset.loaded === "1") return;
  const users = await loadUsersDirectory();
  renderOrderTaskExecutorsList(users);
  list.dataset.loaded = "1";
}

function renderCompletedCheckboxCell(row) {
  const canToggle = canUserAccessTask(row);
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

function renderAllTasksRow(row) {
  const offlineCls = row.__offlinePendingSync ? " tr-order-offline-pending" : "";
  const executors = formatTaskExecutors(normalizeExecutorEmails(row.executor_emails), displayNameByEmail);
  const due = row.due_at ? formatTaskDateRu(row.due_at) : "—";
  return `
    <tr class="all-tasks-row${offlineCls}">
      <td>${escapeHtml(formatTaskDateRu(row.created_at))}</td>
      <td>${escapeHtml(formatTaskAuthorShort(row.author_login))}</td>
      <td class="order-tasks-executors-cell">${escapeHtml(executors)}</td>
      <td>${escapeHtml(due)}</td>
      <td class="order-tasks-text-cell">${escapeHtml(row.body || "")}</td>
      ${renderCompletedCheckboxCell(row)}
    </tr>
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

  const baseRows = data || [];
  if (!error && data) persistOrderTasksSnapshot(data);

  const rows = filterVisibleActiveTasks(mergeOrderTasksRowsForAllTasks(baseRows));
  tbody.innerHTML = rows.map((row) => renderAllTasksRow(row)).join("");

  if (rows.length === 0 && msg) {
    msg.textContent = "Нет актуальных задач.";
  }
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

  const author = getAuthorLogin();
  const executorEmails = getSelectedExecutorEmails();
  const dueAt = datetimeLocalToIso(dueInput?.value);

  const taskPayload = {
    author_login: author,
    body: text,
    executor_emails: executorEmails,
    due_at: dueAt,
    is_completed: false,
  };

  if (isOfflineDataMode()) {
    const localId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `task-${Date.now()}`;
    addPendingOfflineTask({
      localId,
      tempTaskId: nextOfflineTempTaskId(),
      author_login: author,
      body: text,
      executor_emails: executorEmails,
      due_at: dueAt,
      is_completed: false,
      created_at: new Date().toISOString(),
    });
  } else {
    const { error } = await supabaseClient.from("order_tasks").insert(taskPayload);

    if (error) {
      console.error("Ошибка создания задачи:", error);
      if (msg) {
        msg.textContent = "Не удалось сохранить задачу.";
        msg.classList.add("order-tasks-message--error");
      }
      return;
    }
  }

  input.value = "";
  resetTaskFormDefaults();
  if (msg) {
    msg.textContent = "";
    msg.classList.remove("order-tasks-message--error");
  }
  await loadOrderTasks();
  void loadAllTasks();
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

  void ensureOrderTaskExecutorsLoaded();

  bindTaskCompletedCheckboxDelegation(document.getElementById("orderTasksTable"));
  bindTaskCompletedCheckboxDelegation(document.getElementById("allTasksTable"));
}
