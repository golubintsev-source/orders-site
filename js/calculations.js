import { supabaseClient } from "./config.js";
import { checkAuth, loadProfile } from "./auth.js";
import { formatAmount, formatAmountWholeRubles, tryParseRublesInteger, MSG_SUM_INTEGER_ONLY, refreshRublesIntegerInputState } from "./format.js";
import { isAdmin } from "./roles.js";
import { hrefToHome } from "./app-routes.js";
import {
  applySavedScroll,
  initUserPlaceTracking,
  readSavedPlaceForCurrentPage,
} from "./user-place.js";
import {
  flushPendingAccessLogs,
  logSiteAccess,
  measureNavigationResponseMs,
} from "./access-log.js";
import {
  readSnapshot,
  persistCalculationsSnapshot,
  mergeCalculationRows,
  addPendingOfflineCalculation,
  nextOfflineTempCalcId,
  removePendingCalcByTempId,
  isOfflineDataMode,
  isBrowserOffline,
  raceWithTimeout,
} from "./offline-cache.js";

let editingId = null;
let editingCreatedAt = null;
const ORDER_DELTA_CALC_COMMENT_PREFIX = "[AUTO_ORDER_DELTA]";
/** Пустое значение в комментарии расчёта (вместо «—»). */
const CALC_COMMENT_EMPTY = "[__]";
let currentUserEmail = "";

/** Полные строки с сервера; фильтр поиска применяется при отрисовке. */
let calculationsRowsCache = [];
/** Адреса заказов для автозаписей (id → address), подставляются в комментарий при отображении. */
let calcOrderAddressById = new Map();
/** Непустая строка — поиск активен (кнопка «Отменить»). */
let appliedCalculationsSearchQuery = null;

/** Применённый период (YYYY-MM-DD, локальный календарь); таблица и запрос к БД. */
let appliedCalcDateFromYmd = "";
let appliedCalcDateToYmd = "";

const CALC_SALDO_PARTICIPANTS = ["Вова", "Дима", "Касса", "Безнал"];

function localDateToYmd(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function defaultCalcDateRangeYmd() {
  const today = new Date();
  const toYmd = localDateToYmd(today);
  const fromBase = new Date(today);
  fromBase.setDate(fromBase.getDate() - 2);
  const fromYmd = localDateToYmd(fromBase);
  return { fromYmd, toYmd };
}

function localYmdStartMs(ymd) {
  const [y, mo, d] = String(ymd || "")
    .split("-")
    .map((x) => Number(x));
  if (!y || !mo || !d) return NaN;
  return new Date(y, mo - 1, d, 0, 0, 0, 0).getTime();
}

function localYmdEndMs(ymd) {
  const [y, mo, d] = String(ymd || "")
    .split("-")
    .map((x) => Number(x));
  if (!y || !mo || !d) return NaN;
  return new Date(y, mo - 1, d, 23, 59, 59, 999).getTime();
}

function rowCreatedAtInYmdRange(iso, fromYmd, toYmd) {
  if (!iso || !fromYmd || !toYmd) return false;
  const t = new Date(iso).getTime();
  const a = localYmdStartMs(fromYmd);
  const b = localYmdEndMs(toYmd);
  if (Number.isNaN(t) || Number.isNaN(a) || Number.isNaN(b)) return false;
  return t >= a && t <= b;
}

function filterCalcRowsByDateRange(rows, fromYmd, toYmd) {
  return (rows || []).filter((r) => rowCreatedAtInYmdRange(r.created_at, fromYmd, toYmd));
}

/** Выставить поля дат и applied-диапазон по умолчанию (сегодня−2 … сегодня). */
export function initCalculationsDateRangeDefaults() {
  const { fromYmd, toYmd } = defaultCalcDateRangeYmd();
  const fromEl = document.getElementById("calcDateFrom");
  const toEl = document.getElementById("calcDateTo");
  if (fromEl) fromEl.value = fromYmd;
  if (toEl) toEl.value = toYmd;
  appliedCalcDateFromYmd = fromYmd;
  appliedCalcDateToYmd = toYmd;
}

function readCalcPeriodInputs() {
  const fromEl = document.getElementById("calcDateFrom");
  const toEl = document.getElementById("calcDateTo");
  return {
    fromYmd: (fromEl?.value ?? "").trim(),
    toYmd: (toEl?.value ?? "").trim(),
  };
}

/** @returns {Promise<boolean>} true если период применён и данные перезагружены */
async function applyCalculationsPeriodFromInputs() {
  const { fromYmd, toYmd } = readCalcPeriodInputs();
  if (!fromYmd || !toYmd) {
    setMessage("Укажите обе даты периода.", true);
    return false;
  }
  if (localYmdStartMs(fromYmd) > localYmdEndMs(toYmd)) {
    setMessage("Дата «с» не может быть позже даты «по».", true);
    return false;
  }
  appliedCalcDateFromYmd = fromYmd;
  appliedCalcDateToYmd = toYmd;
  setMessage("");
  await loadCalculations();
  return true;
}

/** Одна кнопка «Показать»: период «с»/«по» + запрос к БД + фильтр по полю «Поиск». */
async function applyCalculationsFindCombined() {
  const ok = await applyCalculationsPeriodFromInputs();
  if (!ok) return;
  applyCalculationsSearchFromInput();
}

/** «16 мар 08:11:05» — локальное время. */
function formatCalcTimeRu(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const months = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getDate()} ${months[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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

/** null — пусто; undefined — недопустимые символы (не целые рубли). */
function parseCalcAmountInput(raw) {
  const r = tryParseRublesInteger(raw);
  if (r.invalidFormat) return undefined;
  return r.value;
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

function parseOrderIdFromChip(chip) {
  if (!chip) return null;
  const s = String(chip).trim();
  if (s.startsWith("офл.")) return null;
  const base = s.split("_")[0];
  const n = parseInt(base, 10);
  return Number.isFinite(n) ? n : null;
}

function parseOrderDeltaCommentOrderId(comment) {
  const c = comment ?? "";
  if (!c.startsWith(ORDER_DELTA_CALC_COMMENT_PREFIX)) return null;
  const body = c.slice(ORDER_DELTA_CALC_COMMENT_PREFIX.length).trim();
  const parts = body.split("; ").map((p) => p.trim());
  if (parts.length < 2) return null;
  return parseOrderIdFromChip(parts[1]);
}

/** У автозаписей заказа в конце комментария «; ЧЧ:ММ; автор» — время не показываем в комментарии. */
function stripOrderDeltaTrailingTime(body) {
  const parts = String(body || "")
    .split("; ")
    .map((p) => p.trim());
  if (parts.length >= 5 && /^\d{2}:\d{2}$/.test(parts[parts.length - 2])) {
    return parts.slice(0, -2).join("; ");
  }
  return body;
}

function isCalcAuthorToken(s) {
  const t = String(s ?? "").trim();
  return t === "неизв.." || /\.\.$/.test(t);
}

function extractAuthorFromOrderDeltaBody(body) {
  const parts = String(body || "")
    .split("; ")
    .map((p) => p.trim());
  if (parts.length < 2) return "";
  if (parts.length >= 5 && /^\d{2}:\d{2}$/.test(parts[parts.length - 2])) {
    return parts[parts.length - 1] || "";
  }
  const last = parts[parts.length - 1];
  return isCalcAuthorToken(last) ? last : "";
}

function stripAuthorFromOrderDeltaBody(body) {
  const parts = String(body || "")
    .split("; ")
    .map((p) => p.trim());
  if (parts.length < 2) return body;
  const last = parts[parts.length - 1];
  if (isCalcAuthorToken(last)) {
    return parts.slice(0, -1).join("; ");
  }
  return body;
}

function extractAuthorFromManualComment(comment) {
  const m = String(comment ?? "").match(/;\s*([^;]+)$/);
  if (!m) return "";
  const token = m[1].trim();
  return isCalcAuthorToken(token) ? token : "";
}

function stripAuthorFromManualComment(comment) {
  const c = String(comment ?? "");
  const m = c.match(/;\s*([^;]+)$/);
  if (!m || !isCalcAuthorToken(m[1].trim())) return c;
  return c.slice(0, m.index).trim();
}

export function getCalcDisplayAuthor(comment) {
  const c = comment ?? "";
  if (c.startsWith(ORDER_DELTA_CALC_COMMENT_PREFIX)) {
    const body = c.slice(ORDER_DELTA_CALC_COMMENT_PREFIX.length).trim();
    return extractAuthorFromOrderDeltaBody(body);
  }
  return extractAuthorFromManualComment(c);
}

function isCalcCommentEmptyPart(s) {
  const t = String(s ?? "").trim();
  return t === "" || t === "—" || t === CALC_COMMENT_EMPTY;
}

function formatCalcCommentEmptyPlaceholders(text) {
  if (!text) return text;
  const withPartPlaceholders = text
    .split("; ")
    .map((part) => (part.trim() === "—" ? CALC_COMMENT_EMPTY : part))
    .join("; ");
  return withPartPlaceholders.replace(
    /(кому|оплатил)\s+[−\-—]/g,
    `$1 ${CALC_COMMENT_EMPTY}`
  );
}

function insertAddressAfterClientInDeltaComment(body, address) {
  const addr = String(address ?? "").trim();
  if (!addr || isCalcCommentEmptyPart(addr)) return body;
  const parts = body.split("; ").map((p) => p.trim());
  if (parts.length < 3) return body;
  if (parts[3] === addr) return body;
  if (isCalcCommentEmptyPart(parts[3])) {
    return [...parts.slice(0, 3), addr, ...parts.slice(4)].join("; ");
  }
  return [...parts.slice(0, 3), addr, ...parts.slice(3)].join("; ");
}

export function getCalcDisplayComment(comment) {
  const c = comment ?? "";
  const isOrderDeltaRow = typeof c === "string" && c.startsWith(ORDER_DELTA_CALC_COMMENT_PREFIX);
  if (!isOrderDeltaRow) {
    return formatCalcCommentEmptyPlaceholders(stripAuthorFromManualComment(c));
  }
  const body = c.slice(ORDER_DELTA_CALC_COMMENT_PREFIX.length).trim();
  let display = stripOrderDeltaTrailingTime(body);
  const orderId = parseOrderDeltaCommentOrderId(c);
  if (orderId != null && calcOrderAddressById.has(orderId)) {
    display = insertAddressAfterClientInDeltaComment(display, calcOrderAddressById.get(orderId));
  }
  return formatCalcCommentEmptyPlaceholders(stripAuthorFromOrderDeltaBody(display));
}

async function refreshCalcOrderAddressesForRows(rows) {
  const orderIds = [];
  for (const row of rows || []) {
    const id = parseOrderDeltaCommentOrderId(row.comment);
    if (id != null) orderIds.push(id);
  }
  const uniqueIds = [...new Set(orderIds)];
  calcOrderAddressById = new Map();
  if (!uniqueIds.length) return;

  const fromSnapshot = () => {
    const snapOrders = readSnapshot()?.orders;
    if (!Array.isArray(snapOrders)) return;
    for (const o of snapOrders) {
      if (o?.id != null && uniqueIds.includes(o.id) && o.address != null) {
        calcOrderAddressById.set(o.id, String(o.address).trim());
      }
    }
  };

  if (isOfflineDataMode()) {
    fromSnapshot();
    return;
  }

  try {
    const { data, error } = await raceWithTimeout(
      supabaseClient
        .from("orders")
        .select("id, address")
        .in("id", uniqueIds)
        .is("deleted_at", null),
    );
    if (error) throw error;
    for (const o of data || []) {
      if (o?.id != null && o.address != null && String(o.address).trim()) {
        calcOrderAddressById.set(o.id, String(o.address).trim());
      }
    }
  } catch (e) {
    console.warn("Адреса заказов для комментариев расчётов: используем кэш.", e);
    fromSnapshot();
  }
}

/** Строки, видимые в таблице (период уже в кэше; учитывается активный поиск). */
export function getFilteredCalculationRows() {
  const q =
    appliedCalculationsSearchQuery != null ? String(appliedCalculationsSearchQuery).trim() : "";
  const needle = q ? q.toLowerCase() : "";
  if (!needle) return [...calculationsRowsCache];
  return calculationsRowsCache.filter((row) => rowMatchesCalculationsSearch(row, needle));
}

function rowMatchesCalculationsSearch(row, needleLower) {
  if (!needleLower) return true;
  const displayComment = getCalcDisplayComment(row.comment);
  const displayAuthor = getCalcDisplayAuthor(row.comment);
  const rawComment = row.comment ?? "";
  const parts = [
    displayAuthor,
    formatCalcTimeRu(row.created_at),
    row.created_at || "",
    String(row.from_place ?? ""),
    String(row.to_place ?? ""),
    formatAmount(row.amount),
    String(row.amount ?? ""),
    displayComment,
    rawComment,
    String(row.id ?? ""),
  ];
  return parts.join(" ").toLowerCase().includes(needleLower);
}

function updateCalculationsSearchButton() {
  const btn = document.getElementById("calcSearchBtn");
  if (!btn) return;
  const active =
    appliedCalculationsSearchQuery != null && String(appliedCalculationsSearchQuery).trim() !== "";
  btn.textContent = active ? "Отменить" : "Показать";
  btn.setAttribute("aria-pressed", active ? "true" : "false");
}

function applyCalculationsSearchFromInput() {
  const input = document.getElementById("calcSearchInput");
  const raw = (input?.value ?? "").trim();
  if (!raw) {
    appliedCalculationsSearchQuery = null;
  } else {
    appliedCalculationsSearchQuery = raw;
  }
  updateCalculationsSearchButton();
  renderCalculationsTableFromCache();
}

function cancelCalculationsSearch() {
  appliedCalculationsSearchQuery = null;
  const input = document.getElementById("calcSearchInput");
  if (input) input.value = "";
  updateCalculationsSearchButton();
  renderCalculationsTableFromCache();
}

function formatCalcAmountInput() {
  const amountEl = document.getElementById("calcAmount");
  if (!amountEl) return;
  const raw = amountEl.value;
  if (!String(raw).trim()) return;
  const n = parseCalcAmountInput(raw);
  if (n === undefined) {
    amountEl.classList.add("sum-input-invalid");
    amountEl.title = MSG_SUM_INTEGER_ONLY;
    return;
  }
  amountEl.classList.remove("sum-input-invalid");
  amountEl.removeAttribute("title");
  if (n == null) return;
  amountEl.value = formatAmountWholeRubles(n);
}

function setMessage(text, isError) {
  const el = document.getElementById("calculationsMessage");
  if (el) {
    el.textContent = text || "";
    el.style.color = isError ? "#d32f2f" : "";
  }
}

function computeSaldoFromCalcRows(rows) {
  const balances = Object.fromEntries(CALC_SALDO_PARTICIPANTS.map((p) => [p, 0]));
  for (const row of rows || []) {
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) continue;
    if (Object.prototype.hasOwnProperty.call(balances, row.from_place)) {
      balances[row.from_place] -= amount;
    }
    if (Object.prototype.hasOwnProperty.call(balances, row.to_place)) {
      balances[row.to_place] += amount;
    }
  }
  return balances;
}

function renderCalculationsSaldoTable(rows) {
  const tbody = document.querySelector("#calculationsSaldoTable tbody");
  if (!tbody) return;

  const balances = computeSaldoFromCalcRows(rows);
  tbody.innerHTML = `
    <tr>
      <th scope="row">Сальдо</th>
      ${CALC_SALDO_PARTICIPANTS.map(
        (p) =>
          `<td class="td-money"><span class="status-value">${escapeHtml(formatAmountWholeRubles(balances[p]))}</span></td>`
      ).join("")}
    </tr>
  `;
}

function renderCalculationsTableFromCache() {
  const tbody = document.querySelector("#calculationsTable tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  const q =
    appliedCalculationsSearchQuery != null ? String(appliedCalculationsSearchQuery).trim() : "";
  const needle = q ? q.toLowerCase() : "";
  let rows = calculationsRowsCache;
  if (needle) {
    rows = calculationsRowsCache.filter((row) => rowMatchesCalculationsSearch(row, needle));
  }

  if (calculationsRowsCache.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = "<td colspan=\"7\">Записей пока нет.</td>";
    tbody.appendChild(tr);
    renderCalculationsSaldoTable([]);
    return;
  }

  if (rows.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = "<td colspan=\"7\">Ничего не найдено.</td>";
    tbody.appendChild(tr);
    renderCalculationsSaldoTable([]);
    return;
  }

  rows.forEach((row) => {
    const comment = row.comment ?? "";
    const isOrderDeltaRow = typeof comment === "string" && comment.startsWith(ORDER_DELTA_CALC_COMMENT_PREFIX);
    const displayComment = getCalcDisplayComment(comment);
    const displayAuthor = getCalcDisplayAuthor(comment);
    const escapedComment = escapeHtml(displayComment);
    const isOfflineRow = row.__offlinePendingSync === true;
    const actionsCell = isOfflineRow
      ? isAdmin()
        ? `<td class="td-actions">
        <button type="button" class="btn-icon btn-delete btn-delete-calc" data-id="${row.id}" data-offline-pending="1" title="Удалить локальную запись (ещё не в базе)">${CALC_ICON_DELETE_SVG}</button>
      </td>`
        : `<td class="td-actions td-actions--readonly" aria-hidden="true"></td>`
      : isAdmin() && !isOrderDeltaRow
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
    if (isOfflineRow) tr.classList.add("tr-order-offline-pending");
    tr.innerHTML = `
      <td><span class="status-value">${escapeHtml(formatCalcTimeRu(row.created_at))}</span></td>
      <td class="td-calc-author">${displayAuthor ? `<span class="status-value">${escapeHtml(displayAuthor)}</span>` : ""}</td>
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
      const id = Number(btn.dataset.id);
      if (btn.dataset.offlinePending === "1") {
        btn.addEventListener("click", () => {
          if (!confirm("Удалить локальную запись расчёта? Она ещё не отправлена в базу.")) return;
          removePendingCalcByTempId(id);
          void loadCalculations();
        });
      } else {
        btn.addEventListener("click", () => softDeleteCalculationRow(id));
      }
    });
  }

  renderCalculationsSaldoTable(rows);
}

export async function loadCalculations() {
  const tbody = document.querySelector("#calculationsTable tbody");
  if (!tbody) return;

  if (!appliedCalcDateFromYmd || !appliedCalcDateToYmd) {
    initCalculationsDateRangeDefaults();
  }

  const dateFromInput = document.getElementById("calcDateFrom");
  const dateToInput = document.getElementById("calcDateTo");
  if (dateFromInput) dateFromInput.value = appliedCalcDateFromYmd;
  if (dateToInput) dateToInput.value = appliedCalcDateToYmd;

  const fromIso = new Date(localYmdStartMs(appliedCalcDateFromYmd)).toISOString();
  const toIso = new Date(localYmdEndMs(appliedCalcDateToYmd)).toISOString();

  const calculationsQuery = () =>
    supabaseClient
      .from("calculations")
      .select("id, created_at, from_place, to_place, amount, comment, deleted_at")
      .is("deleted_at", null)
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at", { ascending: false });

  let data = null;
  let error = null;
  if (isBrowserOffline()) {
    error = { message: "offline" };
  } else {
    try {
      const res = await raceWithTimeout(calculationsQuery());
      data = res.data;
      error = res.error;
    } catch (e) {
      if (e?.code === "TIMEOUT") {
        data = null;
        error = { message: "timeout" };
      } else {
        data = null;
        error = e;
      }
    }
  }

  if (error) {
    console.error("Ошибка загрузки расчетов:", error);
    setMessage("Показана копия с устройства; локальные несинхронизированные строки — с жёлтой заливкой.", true);
    const merged = mergeCalculationRows(readSnapshot()?.calculations || []);
    calculationsRowsCache = filterCalcRowsByDateRange(
      merged,
      appliedCalcDateFromYmd,
      appliedCalcDateToYmd
    );
    await refreshCalcOrderAddressesForRows(calculationsRowsCache);
    renderCalculationsTableFromCache();
    return;
  }

  setMessage("");
  const merged = mergeCalculationRows(data || []);
  calculationsRowsCache = filterCalcRowsByDateRange(
    merged,
    appliedCalcDateFromYmd,
    appliedCalcDateToYmd
  );
  persistCalculationsSnapshot(calculationsRowsCache);
  await refreshCalcOrderAddressesForRows(calculationsRowsCache);
  renderCalculationsTableFromCache();
}

function getFormValues() {
  const fromEl = document.getElementById("calcFrom");
  const toEl = document.getElementById("calcTo");
  const amountEl = document.getElementById("calcAmount");
  const commentEl = document.getElementById("calcComment");
  let amountParsed = null;
  if (amountEl && String(amountEl.value).trim() !== "") {
    amountParsed = parseCalcAmountInput(amountEl.value);
  }
  const payload = {
    from_place: fromEl?.value?.trim() || null,
    to_place: toEl?.value?.trim() || null,
    amount: amountParsed === undefined ? undefined : amountParsed,
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
  if (amountEl) {
    amountEl.value = row.amount != null ? formatAmountWholeRubles(row.amount) : "";
    amountEl.classList.remove("sum-input-invalid");
    amountEl.removeAttribute("title");
  }
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
  if (amountEl) {
    amountEl.value = "";
    amountEl.classList.remove("sum-input-invalid");
    amountEl.removeAttribute("title");
  }
  if (commentEl) commentEl.value = "";
  const submitBtn = document.getElementById("calcSubmitBtn");
  if (submitBtn) submitBtn.textContent = "Добавить";
}

function startEdit(id) {
  if (!isAdmin()) return;
  if (isOfflineDataMode() && typeof id === "number" && id < 0) {
    setMessage("Локальную запись нельзя редактировать.", true);
    return;
  }
  if (isOfflineDataMode()) {
    setMessage("Без связи с базой нельзя редактировать сохранённые в базе расчёты.", true);
    return;
  }
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
  const amountEl = document.getElementById("calcAmount");

  if (payload.amount === undefined) {
    if (amountEl) {
      amountEl.classList.add("sum-input-invalid");
      amountEl.title = MSG_SUM_INTEGER_ONLY;
    }
    setMessage(MSG_SUM_INTEGER_ONLY, true);
    return;
  }
  if (payload.amount == null) {
    setMessage("Укажите сумму", true);
    return;
  }

  if (editingId) {
    if (isOfflineDataMode() && typeof editingId === "number" && editingId < 0) {
      setMessage("Редактирование локальной записи расчёта недоступно. Удалите и создайте заново.", true);
      return;
    }
    if (isOfflineDataMode()) {
      setMessage("Без связи с базой нельзя изменять сохранённые в базе расчёты.", true);
      return;
    }
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
    if (isOfflineDataMode()) {
      const localId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `calc-${Date.now()}`;
      addPendingOfflineCalculation({
        localId,
        tempCalcId: nextOfflineTempCalcId(),
        insertPayload,
      });
      setMessage("Запись сохранена на устройстве; отправка в базу при появлении связи.", false);
      resetForm();
      await loadCalculations();
      return;
    }
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
  if (typeof id === "number" && id < 0) {
    if (!confirm("Удалить локальную запись расчёта? Она ещё не отправлена в базу.")) return;
    removePendingCalcByTempId(id);
    await loadCalculations();
    return;
  }
  if (isOfflineDataMode()) {
    setMessage("Без связи с базой нельзя скрывать расчёты из базы.", true);
    return;
  }
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
    amountEl.addEventListener("input", () => refreshRublesIntegerInputState(amountEl, amountEl.value));
  }

  const searchBtn = document.getElementById("calcSearchBtn");
  const searchInput = document.getElementById("calcSearchInput");
  if (searchBtn && searchInput && !searchBtn.dataset.searchBound) {
    searchBtn.dataset.searchBound = "1";
    searchBtn.addEventListener("click", () => {
      const active =
        appliedCalculationsSearchQuery != null &&
        String(appliedCalculationsSearchQuery).trim() !== "";
      if (active) {
        cancelCalculationsSearch();
      } else {
        void applyCalculationsFindCombined();
      }
    });
    searchInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const active =
        appliedCalculationsSearchQuery != null &&
        String(appliedCalculationsSearchQuery).trim() !== "";
      if (active) {
        applyCalculationsSearchFromInput();
      } else {
        void applyCalculationsFindCombined();
      }
    });
  }

  const exportBtn = document.getElementById("calcExportExcelBtn");
  if (exportBtn && !exportBtn.dataset.exportBound) {
    exportBtn.dataset.exportBound = "1";
    exportBtn.addEventListener("click", () => {
      void import("./calculationsExcelExport.js").then((m) => m.exportCalculationsToExcel());
    });
  }

  setupCalcCommentPopover();
}

/** Привязка формы и фильтров без загрузки данных (данные — при открытии раздела). */
export function bindCalculationsSection() {
  initCalculationsDateRangeDefaults();
  setupCalculationsForm();
}

export async function initCalculationsSection() {
  bindCalculationsSection();
  await loadCalculations();
}

async function init() {
  const user = await checkAuth();
  if (!user) return;
  await flushPendingAccessLogs(user);
  initUserPlaceTracking(user.id);
  await loadProfile();
  currentUserEmail = user.email || "";

  void logSiteAccess({
    responseTimeMs: measureNavigationResponseMs(),
    force: true,
  });

  document.getElementById("backToOrdersBtn")?.addEventListener("click", () => {
    window.location.href = hrefToHome();
  });

  initCalculationsDateRangeDefaults();
  setupCalculationsForm();
  await loadCalculations();
  await applySavedScroll(readSavedPlaceForCurrentPage(user.id));
}

init();
