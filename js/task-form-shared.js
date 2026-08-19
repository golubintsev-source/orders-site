import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import { displayNameByEmail } from "./user-names.js";
import { loadUsersDirectory } from "./users-directory.js";
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

export function getSelectedExecutorEmailsFrom(listEl) {
  if (!listEl) return [];
  const emails = [];
  listEl.querySelectorAll(".order-tasks-executor-option[aria-checked='true']").forEach((btn) => {
    const email = btn.getAttribute("data-email");
    if (email) emails.push(email);
  });
  return emails;
}

export function resetTaskExecutorsList(listEl) {
  if (!listEl) return;
  listEl.querySelectorAll(".order-tasks-executor-option").forEach((btn) => {
    btn.setAttribute("aria-checked", "false");
    const mark = btn.querySelector(".order-tasks-executor-checkbox");
    if (mark) mark.classList.remove("order-tasks-executor-checkbox--checked");
  });
}

export function renderTaskExecutorsInto(listEl, hintEl, users) {
  if (!listEl) return;

  if (!users.length) {
    listEl.innerHTML = "";
    if (hintEl) {
      hintEl.textContent = "Нет пользователей для выбора.";
      hintEl.hidden = false;
    }
    return;
  }

  if (hintEl) hintEl.hidden = true;

  listEl.innerHTML = users
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

  listEl.querySelectorAll(".order-tasks-executor-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      const on = btn.getAttribute("aria-checked") !== "true";
      btn.setAttribute("aria-checked", on ? "true" : "false");
      const mark = btn.querySelector(".order-tasks-executor-checkbox");
      if (mark) mark.classList.toggle("order-tasks-executor-checkbox--checked", on);
    });
  });
}

const executorsCacheByListId = new Map();

export async function ensureTaskExecutorsInList(listEl, hintEl) {
  if (!listEl) return;
  const cacheKey = listEl.id || "__anonymous__";
  if (listEl.dataset.loaded === "1") return;
  if (executorsCacheByListId.has(cacheKey)) {
    renderTaskExecutorsInto(listEl, hintEl, executorsCacheByListId.get(cacheKey));
    listEl.dataset.loaded = "1";
    return;
  }
  const users = await loadUsersDirectory();
  executorsCacheByListId.set(cacheKey, users);
  renderTaskExecutorsInto(listEl, hintEl, users);
  listEl.dataset.loaded = "1";
}

/** @returns {Promise<{ error: Error | null }>} */
export async function insertTask({ body, executorEmails, dueAt }) {
  if (!state.currentUser) {
    return { error: new Error("not authenticated") };
  }

  const author = getAuthorLogin();
  const text = String(body || "").trim();
  if (!text) {
    return { error: new Error("empty body") };
  }

  const payload = {
    author_login: author,
    body: text,
    executor_emails: Array.isArray(executorEmails) ? executorEmails : [],
    due_at: dueAt || null,
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
      executor_emails: payload.executor_emails,
      due_at: payload.due_at,
      is_completed: false,
      created_at: new Date().toISOString(),
    });
    return { error: null };
  }

  const { error } = await supabaseClient.from("order_tasks").insert(payload);
  return { error: error || null };
}
