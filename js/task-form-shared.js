import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import { displayNameByEmail } from "./user-names.js";
import { loadTaskExecutorPickerUsers } from "./users-directory.js";
import {
  addPendingOfflineTask,
  nextOfflineTempTaskId,
  isOfflineDataMode,
} from "./offline-cache.js";

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

/** Первый номер заказа из тела сообщения ([[order:123]]). */
export function parseFirstOrderIdFromMessageBody(body) {
  const m = String(body || "").match(/\[\[order:(\d+)\]\]/);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function defaultTaskDueAtLocal() {
  const d = new Date();
  d.setHours(d.getHours() + 3);
  return toDatetimeLocalValue(d);
}

export function datetimeLocalToIso(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function normalizeTaskEmail(raw) {
  return String(raw || "").trim().toLowerCase();
}

export function normalizeExecutorEmails(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((e) => String(e || "").trim()).filter(Boolean);
  }
  return [];
}

export function getCurrentUserEmail() {
  return normalizeTaskEmail(state.currentUser?.email);
}

function getAuthorLogin() {
  const u = state.currentUser;
  if (!u) return "";
  const email = (u.email || "").trim();
  if (email) return email;
  const meta = u.user_metadata || {};
  if (meta.preferred_username) return String(meta.preferred_username).trim();
  if (meta.name) return String(meta.name).trim();
  return String(u.id || "");
}

/** Личная задача: автор — единственный исполнитель. */
export function isSelfAssignedTask(row) {
  const author = normalizeTaskEmail(row?.author_login);
  if (!author) return false;
  const executors = normalizeExecutorEmails(row?.executor_emails)
    .map(normalizeTaskEmail)
    .filter(Boolean);
  if (!executors.length) return false;
  return executors.every((e) => e === author);
}

/** Текущий пользователь указан исполнителем (в т.ч. личная задача «я → я»). */
export function isUserExecutorOfTask(row) {
  const email = getCurrentUserEmail();
  if (!email || !row) return false;
  const executors = normalizeExecutorEmails(row.executor_emails).map(normalizeTaskEmail);
  return executors.includes(email);
}

/** Задача доступна автору; иначе — исполнителям (кроме личной задачи). */
export function canUserAccessTask(row) {
  const email = getCurrentUserEmail();
  if (!email || !row) return false;
  const author = normalizeTaskEmail(row.author_login);
  if (author === email) return true;
  if (isSelfAssignedTask(row)) return false;
  const executors = normalizeExecutorEmails(row.executor_emails).map(normalizeTaskEmail);
  return executors.includes(email);
}

/** Отметить «Выполнена» может автор; для остальных — только если они исполнители. */
export function canUserCompleteTask(row) {
  const email = getCurrentUserEmail();
  if (!email || !row) return false;
  const author = normalizeTaskEmail(row.author_login);
  if (author === email) return true;
  if (isSelfAssignedTask(row)) return false;
  const executors = normalizeExecutorEmails(row.executor_emails).map(normalizeTaskEmail);
  return executors.includes(email);
}

export function getSelectedExecutorEmailsFrom(listEl) {
  if (!listEl) return [];
  const emails = [];
  listEl.querySelectorAll('input[type="checkbox"][data-email]:checked').forEach((input) => {
    const email = input.getAttribute("data-email");
    if (email) emails.push(email);
  });
  return emails;
}

export function resetTaskExecutorsList(listEl) {
  if (!listEl) return;
  listEl.querySelectorAll('input[type="checkbox"][data-email]').forEach((input) => {
    input.checked = false;
  });
}

function executorDisplayLabel(user) {
  const name = displayNameByEmail(user.email);
  return user.isSelf ? `${name} (я)` : name;
}

export function renderTaskExecutorsInto(listEl, hintEl, users) {
  if (!listEl) return;

  if (!users.length) {
    listEl.innerHTML = "";
    if (hintEl) {
      hintEl.textContent = "Нет пользователей для выбора.";
      hint.hidden = false;
    }
    return;
  }

  if (hintEl) hint.hidden = true;

  listEl.innerHTML = users
    .map(
      (user) => `
    <label class="messages-create-group-user order-tasks-executor-user${user.isSelf ? " order-tasks-executor-user--self" : ""}">
      <input type="checkbox" data-email="${escapeHtml(user.email)}" value="${escapeHtml(user.id)}" />
      <span class="messages-create-group-user-name">${escapeHtml(executorDisplayLabel(user))}</span>
    </label>
  `,
    )
    .join("");
}

const executorsCacheByListId = new Map();
let executorsUsersCachePromise = null;

async function loadExecutorPickerUsersCached() {
  if (executorsCacheByListId.has("__users__")) {
    return executorsCacheByListId.get("__users__");
  }
  if (!executorsUsersCachePromise) {
    executorsUsersCachePromise = loadTaskExecutorPickerUsers(state.currentUser).then((users) => {
      executorsCacheByListId.set("__users__", users);
      return users;
    });
  }
  return executorsUsersCachePromise;
}

export async function ensureTaskExecutorsInList(listEl, hintEl) {
  if (!listEl) return;
  const cacheKey = listEl.id || "__anonymous__";
  if (listEl.dataset.loaded === "1") return;

  if (hintEl) {
    hintEl.textContent = "Загрузка пользователей…";
    hintEl.hidden = false;
  }

  if (executorsCacheByListId.has(cacheKey)) {
    renderTaskExecutorsInto(listEl, hintEl, executorsCacheByListId.get(cacheKey));
    listEl.dataset.loaded = "1";
    return;
  }

  try {
    const users = await loadExecutorPickerUsersCached();
    executorsCacheByListId.set(cacheKey, users);
    renderTaskExecutorsInto(listEl, hintEl, users);
    listEl.dataset.loaded = "1";
  } catch (err) {
    console.error("Ошибка загрузки исполнителей:", err);
    listEl.innerHTML = "";
    if (hintEl) {
      hintEl.textContent = "Не удалось загрузить список пользователей.";
      hintEl.hidden = false;
    }
  }
}

/** @returns {Promise<{ error: Error | null }>} */
export async function insertTask({
  body,
  executorEmails,
  dueAt,
  sourceMessageId,
  sourceMessageKind,
  orderId,
}) {
  if (!state.currentUser) {
    return { error: new Error("not authenticated") };
  }

  const author = getAuthorLogin();
  const text = String(body || "").trim();
  if (!text) {
    return { error: new Error("empty body") };
  }

  const linkedOrderId =
    orderId != null && Number.isFinite(Number(orderId)) && Number(orderId) > 0
      ? Number(orderId)
      : null;

  const payload = {
    author_login: author,
    body: text,
    executor_emails: Array.isArray(executorEmails) ? executorEmails : [],
    due_at: dueAt || null,
    is_completed: false,
    order_id: linkedOrderId,
    source_message_id: sourceMessageId ?? null,
    source_message_kind: sourceMessageKind || null,
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
      executor_emails: payload.executor_emails,
      due_at: payload.due_at,
      is_completed: false,
      order_id: payload.order_id,
      source_message_id: payload.source_message_id,
      source_message_kind: payload.source_message_kind,
      created_at: new Date().toISOString(),
    });
    return { error: null };
  }

  const { error } = await supabaseClient.from("order_tasks").insert(payload);
  return { error: error || null };
}
