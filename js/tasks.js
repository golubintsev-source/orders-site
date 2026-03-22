import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import { formatOrderIdTypeChip } from "./format.js";

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

function formatTaskDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

function updateTasksOrderSubtitle() {
  const el = document.getElementById("tasksSectionSubtitle");
  if (!el) return;
  const oid = state.tasksOrderId;
  if (oid == null) {
    el.textContent = "";
    el.hidden = true;
    return;
  }
  const order = state.allOrders?.find((o) => Number(o.id) === Number(oid));
  const chip = order ? formatOrderIdTypeChip(oid, order.order_type) : String(oid);
  el.textContent = `Заказ ${chip}`;
  el.hidden = false;
}

export async function loadOrderTasks() {
  const tbody = document.querySelector("#orderTasksTable tbody");
  const msg = document.getElementById("orderTasksMessage");
  if (!tbody) return;

  updateTasksOrderSubtitle();

  const createBtn = document.getElementById("orderTaskCreateBtn");
  const textInput = document.getElementById("orderTaskTextInput");

  if (state.tasksOrderId == null) {
    tbody.innerHTML = "";
    if (createBtn) createBtn.disabled = true;
    if (textInput) {
      textInput.disabled = true;
      textInput.value = "";
    }
    if (msg) {
      msg.textContent =
        "Выберите заказ: в таблице нажмите на номер заказа → Задачи.";
      msg.classList.remove("order-tasks-message--error");
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
      msg.textContent = "Не удалось загрузить задачи.";
      msg.classList.add("order-tasks-message--error");
    }
    tbody.innerHTML = "";
    return;
  }

  if (msg) msg.classList.remove("order-tasks-message--error");

  const rows = data || [];
  tbody.innerHTML = rows
    .map(
      (row) => `
    <tr>
      <td>${escapeHtml(formatTaskDateTime(row.created_at))}</td>
      <td>${escapeHtml(row.author_login || "—")}</td>
      <td class="order-tasks-text-cell">${escapeHtml(row.body || "")}</td>
    </tr>
  `
    )
    .join("");

  if (rows.length === 0 && msg) {
    msg.textContent = "Пока нет задач по этому заказу.";
  }
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

  input.value = "";
  if (msg) {
    msg.textContent = "";
    msg.classList.remove("order-tasks-message--error");
  }
  await loadOrderTasks();
}

export function initOrderTasksSection() {
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
}
