import { supabaseClient } from "./config.js";
import { checkAuth, loadProfile } from "./auth.js";
import { formatAmount } from "./format.js";
import { isAdmin } from "./roles.js";
import { checkDatabaseAvailable, setDbUnavailableBannerVisible } from "./dbHealth.js";

let editingId = null;
let editingCreatedAt = null;
const ORDER_DELTA_CALC_COMMENT_PREFIX = "[AUTO_ORDER_DELTA]";
let currentUserEmail = "";

function formatDateShort(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const months = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
    return `${d.getDate()} ${months[d.getMonth()]}`;
  } catch {
    return iso;
  }
}

function toDateTimeLocal(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

function escapeHtml(s) {
  if (s == null) return "";
  const div = document.createElement("div");
  div.textContent = String(s);
  return div.innerHTML;
}

function escapeHtmlAttr(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

let calcCommentPopoverEl = null;
let calcCommentPopoverTd = null;

function ensureCalcCommentPopover() {
  if (calcCommentPopoverEl) return calcCommentPopoverEl;
  const el = document.createElement("div");
  el.id = "calcCommentPopover";
  el.className = "calc-comment-popover";
  el.setAttribute("role", "tooltip");
  el.hidden = true;
  el.setAttribute("aria-hidden", "true");
  document.body.appendChild(el);
  calcCommentPopoverEl = el;
  return el;
}

function hideCalcCommentPopover() {
  const el = calcCommentPopoverEl;
  if (!el) return;
  el.hidden = true;
  el.textContent = "";
  el.removeAttribute("style");
  el.setAttribute("aria-hidden", "true");
  calcCommentPopoverTd = null;
  document.removeEventListener("keydown", onCalcCommentPopoverKeydown);
}

function onCalcCommentPopoverKeydown(e) {
  if (e.key === "Escape") hideCalcCommentPopover();
}

function positionCalcCommentPopover(td, popover) {
  const rect = td.getBoundingClientRect();
  const margin = 8;
  const maxW = Math.min(400, window.innerWidth - 2 * margin);
  popover.style.cssText = [
    "position:fixed",
    "z-index:10050",
    `max-width:${maxW}px`,
    `left:${margin}px`,
    `top:${rect.bottom + margin}px`,
    "visibility:hidden",
  ].join(";");
  requestAnimationFrame(() => {
    const ph = popover.offsetHeight;
    const pw = popover.offsetWidth;
    let left = rect.left;
    if (left + pw > window.innerWidth - margin) left = window.innerWidth - margin - pw;
    if (left < margin) left = margin;
    let top = rect.bottom + margin;
    if (top + ph > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - ph - margin);
    }
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    popover.style.visibility = "visible";
  });
}

function showCalcCommentPopover(td) {
  const full = td.dataset.commentFull ?? "";
  if (calcCommentPopoverTd === td && calcCommentPopoverEl && !calcCommentPopoverEl.hidden) {
    hideCalcCommentPopover();
    return;
  }
  calcCommentPopoverTd = td;
  const popover = ensureCalcCommentPopover();
  popover.textContent = full.trim() ? full : "(пусто)";
  popover.hidden = false;
  popover.setAttribute("aria-hidden", "false");
  document.removeEventListener("keydown", onCalcCommentPopoverKeydown);
  document.addEventListener("keydown", onCalcCommentPopoverKeydown);
  positionCalcCommentPopover(td, popover);
  setTimeout(() => {
    document.addEventListener(
      "click",
      function onDocClick(e) {
        if (calcCommentPopoverEl && calcCommentPopoverEl.contains(e.target)) return;
        if (e.target.closest?.("td.td-calc-comment")) return;
        hideCalcCommentPopover();
      },
      { once: true }
    );
  }, 0);
}

function setupCalcCommentPopover() {
  const table = document.getElementById("calculationsTable");
  if (!table || table.dataset.commentPopoverBound) return;
  table.dataset.commentPopoverBound = "1";
  table.addEventListener("click", (e) => {
    const td = e.target.closest("td.td-calc-comment");
    if (!td || !table.contains(td)) return;
    e.preventDefault();
    e.stopPropagation();
    showCalcCommentPopover(td);
  });
  table.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const td = e.target.closest?.("td.td-calc-comment");
    if (!td || !table.contains(td)) return;
    e.preventDefault();
    showCalcCommentPopover(td);
  });
}

/** Как в таблице заказов (#ordersTable .btn-icon) */
const CALC_ICON_EDIT_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;

const CALC_ICON_DELETE_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;

function parseCalcAmountInput(raw) {
  if (raw == null) return null;
  const s0 = String(raw).trim();
  if (!s0) return null;
  // Убираем пробелы-разделители тысяч и незначащие пробелы
  const s = s0.replace(/[\s\u00A0\u202F]/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

function shortLoginByEmail(email) {
  const raw = String(email || "").trim();
  if (!raw) return "неизв..";
  const login = raw.split("@")[0] || raw;
  return `${login.slice(0, 5)}..`;
}

function appendActorToComment(comment) {
  const actor = shortLoginByEmail(currentUserEmail);
  const base = (comment || "").trim();
  return base ? `${base}; ${actor}` : actor;
}

function formatCalcAmountInput() {
  const amountEl = document.getElementById("calcAmount");
  if (!amountEl) return;
  const n = parseCalcAmountInput(amountEl.value);
  if (n == null) return;
  amountEl.value = formatAmount(n);
}

function setMessage(text, isError) {
  const el = document.getElementById("calculationsMessage");
  if (el) {
    el.textContent = text || "";
    el.style.color = isError ? "#d32f2f" : "";
  }
}

export async function loadCalculations() {
  const tbody = document.querySelector("#calculationsTable tbody");
  if (!tbody) return;

  if (!(await checkDatabaseAvailable())) {
    setDbUnavailableBannerVisible(true);
    tbody.innerHTML = "";
    const tr = document.createElement("tr");
    tr.innerHTML = "<td colspan=\"6\">Не удалось загрузить данные.</td>";
    tbody.appendChild(tr);
    setMessage("Ошибка загрузки данных.", true);
    return;
  }

  const { data, error } = await supabaseClient
    .from("calculations")
    .select("id, created_at, from_place, to_place, amount, comment, deleted_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  tbody.innerHTML = "";

  if (error) {
    console.error("Ошибка загрузки расчетов:", error);
    setDbUnavailableBannerVisible(true);
    setMessage("Ошибка загрузки данных.", true);
    return;
  }

  setDbUnavailableBannerVisible(false);
  setMessage("");
  if (!data || data.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = "<td colspan=\"6\">Записей пока нет.</td>";
    tbody.appendChild(tr);
    return;
  }

  data.forEach((row) => {
    const comment = row.comment ?? "";
    const isOrderDeltaRow = typeof comment === "string" && comment.startsWith(ORDER_DELTA_CALC_COMMENT_PREFIX);
    const displayComment = isOrderDeltaRow
      ? comment.slice(ORDER_DELTA_CALC_COMMENT_PREFIX.length).trim()
      : comment;
    const escapedComment = escapeHtml(displayComment);
    const actionsCell =
      isAdmin() && !isOrderDeltaRow
        ? `<td class="td-actions">
        <button type="button" class="btn-icon btn-edit" data-id="${row.id}" title="Редактировать">${CALC_ICON_EDIT_SVG}</button>
        <button type="button" class="btn-icon btn-delete btn-delete-calc" data-id="${row.id}" title="Скрыть из списка (в базе останется пометка удаления)">${CALC_ICON_DELETE_SVG}</button>
      </td>`
        : isAdmin() && isOrderDeltaRow
          ? `<td class="td-actions">
        <button type="button" class="btn-icon btn-delete btn-delete-calc" data-id="${row.id}" title="Скрыть из списка (в базе останется пометка удаления)">${CALC_ICON_DELETE_SVG}</button>
      </td>`
          : `<td class="td-actions td-actions--readonly" aria-hidden="true"></td>`;
    const tr = document.createElement("tr");
    if (isOrderDeltaRow) tr.classList.add("calc-row-system");
    tr.innerHTML = `
      <td><span class="status-value">${escapeHtml(formatDateShort(row.created_at))}</span></td>
      <td>${escapeHtml(row.from_place)}</td>
      <td>${escapeHtml(row.to_place)}</td>
      <td class="td-money"><span class="status-value">${escapeHtml(formatAmount(row.amount))}</span></td>
      <td class="td-calc-comment" data-comment-full="${escapeHtmlAttr(displayComment)}" tabindex="0" role="button" aria-label="Показать полный комментарий"><span class="calc-table-cell-text">${escapedComment}</span></td>
      ${actionsCell}
    `;
    tbody.appendChild(tr);
  });

  if (isAdmin()) {
    tbody.querySelectorAll(".btn-edit").forEach((btn) => {
      btn.addEventListener("click", () => startEdit(Number(btn.dataset.id)));
    });
    tbody.querySelectorAll(".btn-delete-calc").forEach((btn) => {
      btn.addEventListener("click", () => softDeleteCalculationRow(Number(btn.dataset.id)));
    });
  }
}

function getFormValues() {
  const fromEl = document.getElementById("calcFrom");
  const toEl = document.getElementById("calcTo");
  const amountEl = document.getElementById("calcAmount");
  const commentEl = document.getElementById("calcComment");
  const payload = {
    from_place: fromEl?.value?.trim() || null,
    to_place: toEl?.value?.trim() || null,
    amount: amountEl?.value !== "" ? parseCalcAmountInput(amountEl.value) : null,
    comment: appendActorToComment(commentEl?.value?.trim() || ""),
  };
  if (editingId && editingCreatedAt) {
    payload.created_at = editingCreatedAt;
  }
  return payload;
}

function setFormValues(row) {
  const fromEl = document.getElementById("calcFrom");
  const toEl = document.getElementById("calcTo");
  const amountEl = document.getElementById("calcAmount");
  const commentEl = document.getElementById("calcComment");
  if (fromEl) fromEl.value = row.from_place || "";
  if (toEl) toEl.value = row.to_place || "";
  if (amountEl) amountEl.value = row.amount != null ? formatAmount(row.amount) : "";
  if (commentEl) commentEl.value = row.comment || "";
}

function resetForm() {
  editingId = null;
  editingCreatedAt = null;
  const fromEl = document.getElementById("calcFrom");
  const toEl = document.getElementById("calcTo");
  const amountEl = document.getElementById("calcAmount");
  const commentEl = document.getElementById("calcComment");
  if (fromEl) fromEl.value = "";
  if (toEl) toEl.value = "";
  if (amountEl) amountEl.value = "";
  if (commentEl) commentEl.value = "";
  const submitBtn = document.getElementById("calcSubmitBtn");
  if (submitBtn) submitBtn.textContent = "Добавить";
}

function startEdit(id) {
  if (!isAdmin()) return;
  editingId = id;
  editingCreatedAt = null;
  document.getElementById("calcSubmitBtn").textContent = "Сохранить";
  supabaseClient
    .from("calculations")
    .select("id, created_at, from_place, to_place, amount, comment")
    .eq("id", id)
    .is("deleted_at", null)
    .single()
    .then(({ data, error }) => {
      if (error || !data) {
        setMessage("Ошибка загрузки записи.", true);
        return;
      }
      editingCreatedAt = data.created_at;
      setFormValues(data);
    });
}

async function submitForm(e) {
  e.preventDefault();
  const payload = getFormValues();

  if (editingId) {
    if (!isAdmin()) {
      setMessage("Изменение записей доступно только администратору.", true);
      resetForm();
      return;
    }
    const { error } = await supabaseClient
      .from("calculations")
      .update(payload)
      .eq("id", editingId)
      .is("deleted_at", null);
    if (error) {
      console.error("Ошибка обновления:", error);
      setMessage("Ошибка при сохранении.", true);
      return;
    }
    setMessage("Запись обновлена.");
    resetForm();
  } else {
    const insertPayload = { ...payload, created_at: new Date().toISOString() };
    const { error } = await supabaseClient.from("calculations").insert([insertPayload]);
    if (error) {
      console.error("Ошибка добавления:", error);
      setMessage("Ошибка при добавлении.", true);
      return;
    }
    setMessage("");
    resetForm();
  }
  await loadCalculations();
}

/** Запись не удаляется из БД — только выставляется deleted_at. */
async function softDeleteCalculationRow(id) {
  if (!isAdmin()) return;
  if (
    !confirm(
      "Скрыть эту запись из списка? В базе останется пометка удаления, строка не удаляется физически."
    )
  ) {
    return;
  }
  const { error } = await supabaseClient
    .from("calculations")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) {
    console.error("Ошибка пометки удаления:", error);
    setMessage("Не удалось пометить запись. Проверьте колонку deleted_at в таблице calculations.", true);
    return;
  }
  if (editingId === id) resetForm();
  setMessage("Запись скрыта из списка.");
  await loadCalculations();
}

function setupCalculationsForm() {
  const form = document.getElementById("calculationsForm");
  if (form) form.addEventListener("submit", submitForm);

  const amountEl = document.getElementById("calcAmount");
  if (amountEl) {
    amountEl.addEventListener("blur", formatCalcAmountInput);
  }

  setupCalcCommentPopover();
}

export async function initCalculationsSection() {
  setupCalculationsForm();
  await loadCalculations();
}

async function init() {
  const user = await checkAuth();
  if (!user) return;
  await loadProfile();
  currentUserEmail = user.email || "";

  document.getElementById("backToOrdersBtn")?.addEventListener("click", () => {
    window.location.href = "index.html";
  });

  setupCalculationsForm();
  await loadCalculations();
}

init();
