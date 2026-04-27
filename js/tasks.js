import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import { formatOrderIdTypeChip, formatTaskDateRu, formatTaskAuthorShort } from "./format.js";
import { applyFiltersAndRender } from "./orders.js";
import { switchSection } from "./section-nav.js";
import { isOrderHiddenForCurrentRole, isUserLite, isUserShop } from "./roles.js";
import {
  readSnapshot,
  persistOrderTasksSnapshot,
  mergeOrderTasksRowsForAllTasks,
  mergeOrderTasksRowsForOrder,
  addPendingOfflineTask,
  nextOfflineTempTaskId,
  isOfflineClientOrderId,
  isOfflineDataMode,
} from "./offline-cache.js";

function escapeHtml(s) {
  if (s == null) return "";
  const div = document.createElement("div");
  div.textContent = String(s);
  return div.innerHTML;
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

  const { data, error } = await supabaseClient
    .from("order_tasks")
    .select("id, created_at, author_login, body, order_id")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Ошибка загрузки задач:", error);
    if (msg) {
      msg.textContent = "Показаны сохранённые на устройстве задачи (сеть недоступна).";
      msg.classList.remove("order-tasks-message--error");
    }
  }

  const baseRows = error ? readSnapshot()?.order_tasks || [] : data || [];
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
      return `
    <tr class="${trClass}" data-order-id="${oid}">
      <td>${escapeHtml(chip)}</td>
      <td>${escapeHtml(formatTaskDateRu(row.created_at))}</td>
      <td>${escapeHtml(formatTaskAuthorShort(row.author_login))}</td>
      <td class="order-tasks-text-cell">${escapeHtml(row.body || "")}</td>
    </tr>
  `;
    })
    .join("");

  if (rows.length === 0 && msg) {
    msg.textContent = error ? "Нет сохранённой копии задач на этом устройстве." : "Пока нет задач.";
  }
}

export async function loadOrderTasks() {
  const tbody = document.querySelector("#orderTasksTable tbody");
  const msg = document.getElementById("orderTasksMessage");
  if (!tbody) return;

  const createBtn = document.getElementById("orderTaskCreateBtn");
  const textInput = document.getElementById("orderTaskTextInput");

  if (state.tasksOrderId == null) {
    tbody.innerHTML = "";
    if (createBtn) createBtn.disabled = true;
    if (textInput) {
      textInput.disabled = true;
      textInput.value = "";
    }
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
    if (createBtn) createBtn.disabled = true;
    if (textInput) textInput.disabled = true;
    setHighlightCheckboxNoOrder();
    if (msg) {
      msg.textContent = "Нет доступа к задачам этого заказа.";
      msg.classList.add("order-tasks-message--error");
    }
    return;
  }

  if (createBtn) createBtn.disabled = false;
  if (textInput) textInput.disabled = false;

  if (msg) msg.textContent = "";

  const { data, error } = await supabaseClient
    .from("order_tasks")
    .select("id, created_at, author_login, body")
    .eq("order_id", state.tasksOrderId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Ошибка загрузки задач:", error);
    if (msg) {
      msg.textContent = "Показаны сохранённые на устройстве задачи (сеть недоступна).";
      msg.classList.remove("order-tasks-message--error");
    }
  }

  if (msg && !error) msg.classList.remove("order-tasks-message--error");

  const baseRows = error
    ? (readSnapshot()?.order_tasks || []).filter((r) => Number(r.order_id) === Number(state.tasksOrderId))
    : data || [];

  const rows = mergeOrderTasksRowsForOrder(baseRows, state.tasksOrderId);
  tbody.innerHTML = rows
    .map(
      (row) => `
    <tr class="${row.__offlinePendingSync ? "tr-order-offline-pending" : ""}">
      <td>${escapeHtml(formatTaskDateRu(row.created_at))}</td>
      <td>${escapeHtml(formatTaskAuthorShort(row.author_login))}</td>
      <td class="order-tasks-text-cell">${escapeHtml(row.body || "")}</td>
    </tr>
  `
    )
    .join("");

  if (rows.length === 0 && msg) {
    msg.textContent = "Пока нет задач по этому заказу.";
  }

  await applyHighlightCheckboxAfterTasksLoad(rows.length);
}

export async function createOrderTask() {
  const input = document.getElementById("orderTaskTextInput");
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
      created_at: new Date().toISOString(),
    });
    const o = state.allOrders?.find((x) => Number(x.id) === Number(state.tasksOrderId));
    if (o) o.tasks_highlight = true;
    const cb = document.getElementById("orderTaskHighlightCheckbox");
    if (cb) cb.checked = true;
    applyFiltersAndRender();
  } else {
    const { error } = await supabaseClient.from("order_tasks").insert({
      order_id: state.tasksOrderId,
      author_login: author,
      body: text,
    });

    if (error) {
      console.error("Ошибка создания задачи:", error);
      if (msg) {
        msg.textContent = "Не удалось сохранить задачу.";
        msg.classList.add("order-tasks-message--error");
      }
      return;
    }

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
  if (msg) {
    msg.textContent = "";
    msg.classList.remove("order-tasks-message--error");
  }
  await loadOrderTasks();
  void loadAllTasks();
}

export function initOrderTasksSection() {
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
