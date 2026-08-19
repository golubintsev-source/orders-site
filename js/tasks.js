import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import {
  formatOrderIdTypeChip,
  formatTaskDateRu,
  formatTaskAuthorShort,
  formatTaskExecutors,
} from "./format.js";
import { displayNameByEmail } from "./user-names.js";
import { loadUsersDirectory } from "./users-directory.js";
import { applyFiltersAndRender } from "./orders.js";
import { switchSection } from "./section-nav.js";
import { isOrderHiddenForCurrentRole, isUserLite, isUserShop } from "./roles.js";
import {
  persistOrderTasksSnapshot,
  mergeOrderTasksRowsForAllTasks,
  mergeOrderTasksRowsForOrder,
  addPendingOfflineTask,
  addPendingOfflineOrderHistory,
  nextOfflineTempTaskId,
  isOfflineClientOrderId,
  isOfflineDataMode,
} from "./offline-cache.js";
import { fetchAllSupabaseRows } from "./supabase-fetch.js";

const TASK_SELECT_FIELDS = "id, created_at, author_login, body, order_id, due_at, executor_emails";
const TASK_SELECT_FIELDS_ORDER = "id, created_at, author_login, body, due_at, executor_emails";

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

function orderTasksHighlightFromOrder(order) {
  if (!order) return false;
  const v = order.tasks_highlight;
  return v === true || v === 1 || v === "1";
}

function canAccessOrderTasksByOrderId(orderId) {
  const order = state.allOrders?.find((o) => Number(o.id) === Number(orderId));
  if (!order) return !(isUserLite() || isUserShop());
  return !isOrderHiddenForCurrentRole(order);
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

function renderTaskTableRowCells(row) {
  const executors = formatTaskExecutors(normalizeExecutorEmails(row.executor_emails), displayNameByEmail);
  const due = row.due_at ? formatTaskDateRu(row.due_at) : "—";
  return `
      <td>${escapeHtml(formatTaskDateRu(row.created_at))}</td>
      <td>${escapeHtml(formatTaskAuthorShort(row.author_login))}</td>
      <td class="order-tasks-executors-cell">${escapeHtml(executors)}</td>
      <td>${escapeHtml(due)}</td>
      <td class="order-tasks-text-cell">${escapeHtml(row.body || "")}</td>
  `;
}

async function writeTaskChangeToHistory(orderId, taskBody) {
  if (!orderId || !taskBody) return;
  const userEmail = state.currentUser?.email;
  if (!userEmail) return;
  const text = String(taskBody).trim();
  if (!text) return;
  const comment = `Задача: ${text}`;
  const { error } = await supabaseClient.from("order_history").insert([
    { order_id: orderId, user_email: userEmail, comment },
  ]);
  if (error) {
    console.error("Ошибка записи задачи в историю изменений:", error);
  }
}

/** Красная подсветка чекбокса и строк таблицы на странице «Задачи по заказу». */
function syncOrderTasksPageHighlightClass() {
  const section = document.getElementById("section-order-tasks");
  const cb = document.getElementById("orderTaskHighlightCheckbox");
  if (!section || !cb) return;
  const on = cb.checked && !cb.disabled;
  section.classList.toggle("order-tasks-page--highlight", on);
}

function setHighlightCheckboxNoOrder() {
  const cb = document.getElementById("orderTaskHighlightCheckbox");
  if (!cb) return;
  cb.checked = false;
  cb.disabled = true;
  syncOrderTasksPageHighlightClass();
}

async function applyHighlightCheckboxAfterTasksLoad(taskCount) {
  const cb = document.getElementById("orderTaskHighlightCheckbox");
  if (!cb) return;

  try {
    if (state.tasksOrderId == null) {
      setHighlightCheckboxNoOrder();
      return;
    }

    if (taskCount === 0) {
      cb.disabled = true;
      cb.checked = false;
      const o = state.allOrders?.find((x) => Number(x.id) === Number(state.tasksOrderId));
      if (o && orderTasksHighlightFromOrder(o)) {
        if (isOfflineClientOrderId(state.tasksOrderId)) {
          o.tasks_highlight = false;
          applyFiltersAndRender();
          void loadAllTasks();
        } else {
          const { error } = await supabaseClient
            .from("orders")
            .update({ tasks_highlight: false })
            .eq("id", state.tasksOrderId);
          if (!error) {
            o.tasks_highlight = false;
            applyFiltersAndRender();
            void loadAllTasks();
          }
        }
      }
      return;
    }

    cb.disabled = false;
    const order = state.allOrders?.find((o) => Number(o.id) === Number(state.tasksOrderId));
    cb.checked = orderTasksHighlightFromOrder(order);
  } finally {
    syncOrderTasksPageHighlightClass();
  }
}

async function saveOrderTasksHighlight(checked) {
  const cb = document.getElementById("orderTaskHighlightCheckbox");
  if (state.tasksOrderId == null || !cb || cb.disabled) return;
  const id = state.tasksOrderId;
  if (isOfflineClientOrderId(id)) {
    const o = state.allOrders?.find((x) => Number(x.id) === Number(id));
    if (o) o.tasks_highlight = checked;
    applyFiltersAndRender();
    syncOrderTasksPageHighlightClass();
    return;
  }
  const { error } = await supabaseClient.from("orders").update({ tasks_highlight: checked }).eq("id", id);
  if (error) {
    console.error("Ошибка сохранения выделения:", error);
    void loadOrderTasks();
    return;
  }
  const o = state.allOrders?.find((x) => Number(x.id) === Number(id));
  if (o) o.tasks_highlight = checked;
  applyFiltersAndRender();
  syncOrderTasksPageHighlightClass();
}

export async function loadAllTasks() {
  const tbody = document.querySelector("#allTasksTable tbody");
  const msg = document.getElementById("allTasksMessage");
  if (!tbody) return;
  if (msg) {
    msg.textContent = "";
    msg.classList.remove("order-tasks-message--error");
  }

  const { data, error } = await fetchAllSupabaseRows(() =>
    supabaseClient
      .from("order_tasks")
      .select(TASK_SELECT_FIELDS)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }),
  );

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

  const rows = mergeOrderTasksRowsForAllTasks(baseRows);
  tbody.innerHTML = rows
    .map((row) => {
      const order = state.allOrders?.find((o) => Number(o.id) === Number(row.order_id));
      if (!canAccessOrderTasksByOrderId(row.order_id)) return "";
      const chip = formatOrderIdTypeChip(row.order_id, order?.order_type);
      const highlight = orderTasksHighlightFromOrder(order);
      const offlineCls = row.__offlinePendingSync ? " tr-order-offline-pending" : "";
      const trClass = `${highlight ? "all-tasks-row all-tasks-row--highlight" : "all-tasks-row"}${offlineCls}`;
      const oid = row.order_id != null ? String(row.order_id) : "";
      const executors = formatTaskExecutors(normalizeExecutorEmails(row.executor_emails), displayNameByEmail);
      const due = row.due_at ? formatTaskDateRu(row.due_at) : "—";
      return `
    <tr class="${trClass}" data-order-id="${oid}">
      <td>${escapeHtml(chip)}</td>
      <td>${escapeHtml(formatTaskDateRu(row.created_at))}</td>
      <td>${escapeHtml(formatTaskAuthorShort(row.author_login))}</td>
      <td class="order-tasks-executors-cell">${escapeHtml(executors)}</td>
      <td>${escapeHtml(due)}</td>
      <td class="order-tasks-text-cell">${escapeHtml(row.body || "")}</td>
    </tr>
  `;
    })
    .join("");

  if (rows.length === 0 && msg) {
    msg.textContent = "Пока нет задач.";
  }
}

export async function loadOrderTasks() {
  const tbody = document.querySelector("#orderTasksTable tbody");
  const msg = document.getElementById("orderTasksMessage");
  if (!tbody) return;

  const textInput = document.getElementById("orderTaskTextInput");

  void ensureOrderTaskExecutorsLoaded();

  if (state.tasksOrderId == null) {
    tbody.innerHTML = "";
    setTaskFormDisabled(true);
    if (textInput) textInput.value = "";
    lastTaskFormOrderId = null;
    setHighlightCheckboxNoOrder();
    if (msg) {
      msg.textContent =
        "Выберите заказ: в таблице нажмите на номер заказа → Задачи.";
      msg.classList.remove("order-tasks-message--error");
    }
    return;
  }

  if (!canAccessOrderTasksByOrderId(state.tasksOrderId)) {
    tbody.innerHTML = "";
    setTaskFormDisabled(true);
    setHighlightCheckboxNoOrder();
    if (msg) {
      msg.textContent = "Нет доступа к задачам этого заказа.";
      msg.classList.add("order-tasks-message--error");
    }
    return;
  }

  setTaskFormDisabled(false);
  syncTaskFormForOrder(state.tasksOrderId);

  if (msg) msg.textContent = "";

  const { data, error } = await supabaseClient
    .from("order_tasks")
    .select(TASK_SELECT_FIELDS_ORDER)
    .eq("order_id", state.tasksOrderId)
    .order("created_at", { ascending: false });

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

  const baseRows = data || [];

  const rows = mergeOrderTasksRowsForOrder(baseRows, state.tasksOrderId);
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
    msg.textContent = "Пока нет задач по этому заказу.";
  }

  await applyHighlightCheckboxAfterTasksLoad(rows.length);
}

export async function createOrderTask() {
  const input = document.getElementById("orderTaskTextInput");
  const dueInput = document.getElementById("orderTaskDueAtInput");
  const msg = document.getElementById("orderTasksMessage");
  if (!input || state.tasksOrderId == null) return;

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

  if (!canAccessOrderTasksByOrderId(state.tasksOrderId)) {
    if (msg) {
      msg.textContent = "Нет доступа к задачам этого заказа.";
      msg.classList.add("order-tasks-message--error");
    }
    return;
  }

  if (isOfflineDataMode() && !isOfflineClientOrderId(state.tasksOrderId)) {
    if (msg) {
      msg.textContent =
        "Без связи с базой задачи можно добавлять только к заявкам, созданным на этом устройстве без сети (жёлтая строка в списке заказов).";
      msg.classList.add("order-tasks-message--error");
    }
    return;
  }

  const taskPayload = {
    order_id: state.tasksOrderId,
    author_login: author,
    body: text,
    executor_emails: executorEmails,
    due_at: dueAt,
  };

  if (isOfflineClientOrderId(state.tasksOrderId)) {
    const localId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `task-${Date.now()}`;
    addPendingOfflineTask({
      localId,
      tempTaskId: nextOfflineTempTaskId(),
      order_id: state.tasksOrderId,
      author_login: author,
      body: text,
      executor_emails: executorEmails,
      due_at: dueAt,
      created_at: new Date().toISOString(),
    });
    const orderLocalId = state.allOrders?.find((x) => Number(x.id) === Number(state.tasksOrderId))
      ?.__offlineLocalId;
    if (orderLocalId) {
      const histLocalId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `hist-task-${Date.now()}`;
      addPendingOfflineOrderHistory({
        localId: histLocalId,
        pending_order_local_id: orderLocalId,
        order_temp_id: state.tasksOrderId,
        user_email: state.currentUser?.email || author,
        comment: `Задача: ${text}`,
      });
    }
    const o = state.allOrders?.find((x) => Number(x.id) === Number(state.tasksOrderId));
    if (o) o.tasks_highlight = true;
    const cb = document.getElementById("orderTaskHighlightCheckbox");
    if (cb) cb.checked = true;
    applyFiltersAndRender();
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

    await writeTaskChangeToHistory(state.tasksOrderId, text);

    const { error: hlErr } = await supabaseClient
      .from("orders")
      .update({ tasks_highlight: true })
      .eq("id", state.tasksOrderId);

    if (hlErr) {
      console.error("Ошибка выделения заказа:", hlErr);
    } else {
      const o = state.allOrders?.find((x) => Number(x.id) === Number(state.tasksOrderId));
      if (o) o.tasks_highlight = true;
      const cb = document.getElementById("orderTaskHighlightCheckbox");
      if (cb) cb.checked = true;
      applyFiltersAndRender();
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
let lastTaskFormOrderId = null;

function syncTaskFormForOrder(orderId) {
  const dueInput = document.getElementById("orderTaskDueAtInput");
  const orderChanged = lastTaskFormOrderId !== orderId;
  lastTaskFormOrderId = orderId;

  if (orderChanged) {
    const textInput = document.getElementById("orderTaskTextInput");
    if (textInput) textInput.value = "";
    resetTaskFormDefaults();
    return;
  }

  if (dueInput && !dueInput.disabled && !dueInput.value) {
    dueInput.value = defaultTaskDueAtLocal();
  }
}

export function initOrderTasksSection() {
  if (orderTasksSectionInited) return;
  orderTasksSectionInited = true;
  const createBtn = document.getElementById("orderTaskCreateBtn");
  const input = document.getElementById("orderTaskTextInput");
  const highlightCb = document.getElementById("orderTaskHighlightCheckbox");
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
  if (highlightCb) {
    highlightCb.addEventListener("change", () => {
      syncOrderTasksPageHighlightClass();
      void saveOrderTasksHighlight(highlightCb.checked);
    });
  }

  void ensureOrderTaskExecutorsLoaded();

  const allTasksTable = document.getElementById("allTasksTable");
  if (allTasksTable) {
    allTasksTable.addEventListener("click", (e) => {
      const tr = e.target.closest("tbody tr");
      if (!tr || !allTasksTable.contains(tr)) return;
      const raw = tr.getAttribute("data-order-id");
      const id = raw ? Number(raw) : NaN;
      if (Number.isNaN(id)) return;
      if (!canAccessOrderTasksByOrderId(id)) return;
      state.tasksOrderId = id;
      switchSection("order-tasks");
    });
  }
}
