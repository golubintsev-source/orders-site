import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import {
  canSaveManagerSalaryChecks,
  isOrderHiddenForCurrentRole,
  isOrderEditLockedForUserLite,
  isShopOrder,
} from "./roles.js";
import { formatAmount, formatAmountWholeRubles, formatDateShortRU, formatOrderIdTypeChip } from "./format.js";
import { orderHasActiveTask } from "./order-task-links.js";

/** Статусы с «Производство» и далее, включая «Заказ закрыт». */
const MANAGER_SALARY_STATUSES = new Set([
  "Производство",
  "Товар передан заказчику",
  "Монтаж выполнен",
  "Заказ закрыт",
]);

/** Префикс ключа в app_settings: manager_salary_unchecked_YYYY-MM-DD_YYYY-MM-DD */
const SETTINGS_KEY_PREFIX = "manager_salary_unchecked_";

/** YYYY-MM-DD в локальной календарной дате. */
function ymdLocal(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Первое число текущего месяца (локально). */
function defaultDateFromYmd() {
  const now = new Date();
  return ymdLocal(new Date(now.getFullYear(), now.getMonth(), 1));
}

/** Сегодняшняя дата (локально). */
function defaultDateToYmd() {
  return ymdLocal(new Date());
}

/** Выбранный период YYYY-MM-DD; по умолчанию — с 1-го числа текущего месяца по сегодня. */
let selectedDateFrom = defaultDateFromYmd();
let selectedDateTo = defaultDateToYmd();

/** id заказов, снятых с учёта (чекбокс снят). По умолчанию все учтены. */
const uncheckedOrderIds = new Set();

/** Последнее сохранённое в БД состояние снятых чекбоксов для текущего периода. */
const savedUncheckedOrderIds = new Set();

/** Ключ периода, для которого уже загружены сохранённые чекбоксы. */
let loadedPeriodKey = null;

let bound = false;
let saveInFlight = false;
let loadToken = 0;

function periodKey(fromYmd, toYmd) {
  return `${fromYmd}_${toYmd}`;
}

function settingsKeyForPeriod(fromYmd, toYmd) {
  return `${SETTINGS_KEY_PREFIX}${periodKey(fromYmd, toYmd)}`;
}

/** Старый ключ по месяцу (обратная совместимость при чтении). */
function settingsKeyForMonth(monthKey) {
  return `${SETTINGS_KEY_PREFIX}${monthKey}`;
}

function escapeHtml(s) {
  if (s == null || s === "") return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

function parseLooseNumber(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim().replace(/[\s\u00A0\u202F]/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function getOrderCalendarYmd(order) {
  const raw = order.order_date;
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [yy, mm, dd] = s.slice(0, 10).split("-").map(Number);
    const d = new Date(yy, mm - 1, dd);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function normalizeStatus(val) {
  if (val === "нет" || val === "оплачен" || val == null || val === "") return "Контакт с клиентом";
  return String(val).trim();
}

function isOrderPaid(order) {
  const remainingToRaw = (order.remaining_to || "").trim();
  const paidByRemainingTo = remainingToRaw !== "" && remainingToRaw !== "—";
  const remainingAmount = parseLooseNumber(order.remaining_amount);
  const paidByRemainingAmountZero = remainingAmount != null && Math.abs(remainingAmount) < 1e-9;
  return paidByRemainingTo || paidByRemainingAmountZero;
}

/**
 * Сумма, уже поступившая по заказу для сводки «Оплачено»:
 * полностью оплаченный — вся стоимость; иначе — предоплата (частичная оплата).
 */
function getOrderPaidAmount(order) {
  const amount = parseLooseNumber(order.amount);
  if (isOrderPaid(order)) {
    return amount != null ? amount : 0;
  }
  const prepayment = parseLooseNumber(order.prepayment);
  if (prepayment != null && prepayment > 0) {
    return prepayment;
  }
  return 0;
}

function isOplahenoPaidNoAlert(order) {
  if (order.amount == null || order.amount === "") return false;
  if (isOrderPaid(order)) return false;
  const status = order.payment_status || "";
  return status === "Производство" || status === "Товар передан заказчику" || status === "Монтаж выполнен";
}

function isRemainingAmountZero(order) {
  const remainingAmount = parseLooseNumber(order.remaining_amount);
  return remainingAmount != null && Math.abs(remainingAmount) < 1e-9;
}

function paidBadge(order) {
  if (order.amount == null || order.amount === "") return "";
  if (isOrderPaid(order)) return '<span class="status-paid">да</span>';
  if (isOplahenoPaidNoAlert(order)) return '<span class="paid-no-alert">нет</span>';
  return '<span class="status-value">нет</span>';
}

function formatYmdRu(ymd) {
  if (!ymd || ymd.length < 10) return String(ymd || "");
  const [y, m, d] = ymd.slice(0, 10).split("-");
  if (!y || !m || !d) return String(ymd);
  return `${d}.${m}.${y}`;
}

function formatPeriodLabel(fromYmd, toYmd) {
  return `${formatYmdRu(fromYmd)}–${formatYmdRu(toYmd)}`;
}

function isValidYmd(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function syncDateInputs() {
  const fromEl = document.getElementById("managerSalaryDateFrom");
  const toEl = document.getElementById("managerSalaryDateTo");
  if (fromEl) fromEl.value = selectedDateFrom;
  if (toEl) toEl.value = selectedDateTo;
}

/**
 * Читает даты из инпутов, нормализует (пустые → дефолт, from > to → swap)
 * и обновляет selectedDateFrom / selectedDateTo.
 */
function readAndNormalizeDateRange() {
  const fromEl = document.getElementById("managerSalaryDateFrom");
  const toEl = document.getElementById("managerSalaryDateTo");
  let fromYmd = (fromEl?.value || "").trim();
  let toYmd = (toEl?.value || "").trim();

  if (!isValidYmd(fromYmd)) fromYmd = defaultDateFromYmd();
  if (!isValidYmd(toYmd)) toYmd = defaultDateToYmd();

  if (fromYmd > toYmd) {
    const tmp = fromYmd;
    fromYmd = toYmd;
    toYmd = tmp;
  }

  selectedDateFrom = fromYmd;
  selectedDateTo = toYmd;
  syncDateInputs();
  return { fromYmd, toYmd };
}

function getManagerSalaryOrders() {
  const fromYmd = selectedDateFrom;
  const toYmd = selectedDateTo;
  const list = (state.allOrders || []).filter((order) => {
    if (isOrderHiddenForCurrentRole(order)) return false;
    if (isShopOrder(order)) return false;
    const status = normalizeStatus(order.payment_status);
    if (!MANAGER_SALARY_STATUSES.has(status)) return false;
    const ymd = getOrderCalendarYmd(order);
    if (!ymd) return false;
    return ymd >= fromYmd && ymd <= toYmd;
  });

  return list.slice().sort((a, b) => {
    const da = getOrderCalendarYmd(a) || "";
    const db = getOrderCalendarYmd(b) || "";
    if (da !== db) return da < db ? 1 : -1;
    return Number(b.id) - Number(a.id);
  });
}

function orderIdKey(order) {
  return String(order.id);
}

function isOrderChecked(order) {
  return !uncheckedOrderIds.has(orderIdKey(order));
}

function parseUncheckedIds(raw) {
  if (raw == null || raw === "") return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((id) => String(id)).filter(Boolean);
  } catch {
    return [];
  }
}

function visibleUncheckedIds(visibleIds) {
  const ids = [];
  for (const id of uncheckedOrderIds) {
    if (visibleIds.has(id)) ids.push(id);
  }
  ids.sort();
  return ids;
}

function setsEqualForVisible(a, b, visibleIds) {
  const left = [];
  const right = [];
  for (const id of a) {
    if (visibleIds.has(id)) left.push(id);
  }
  for (const id of b) {
    if (visibleIds.has(id)) right.push(id);
  }
  left.sort();
  right.sort();
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function setSaveMessage(text, isError = false) {
  const el = document.getElementById("managerSalarySaveMessage");
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = "";
    el.classList.remove("is-error");
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.classList.toggle("is-error", Boolean(isError));
}

function updateSaveButtonState() {
  const btn = document.getElementById("managerSalarySaveChecksBtn");
  if (!btn) return;

  const allowed = canSaveManagerSalaryChecks();
  const orders = getManagerSalaryOrders();
  const visibleIds = new Set(orders.map(orderIdKey));
  const isDirty = !setsEqualForVisible(uncheckedOrderIds, savedUncheckedOrderIds, visibleIds);
  const canSave = allowed && isDirty && !saveInFlight;

  btn.disabled = !canSave;
  btn.classList.toggle("manager-salary-save-btn-inactive", !canSave);
  btn.hidden = !allowed;
  const saveRow = btn.closest(".manager-salary-save-row");
  if (saveRow) saveRow.hidden = !allowed;
  if (!allowed) setSaveMessage("");
}

/** Базовая часть зарплаты менеджера (руб.) + процент от стоимости. */
const MANAGER_SALARY_BASE = 22000;
const MANAGER_SALARY_COST_RATE = 0.015;

function updateSummary(orders) {
  const countEl = document.getElementById("managerSalaryCount");
  const sumEl = document.getElementById("managerSalarySum");
  const paidSumEl = document.getElementById("managerSalaryPaidSum");
  const salaryResultEl = document.getElementById("managerSalaryResult");
  if (!countEl || !sumEl) return;

  let count = 0;
  let sum = 0;
  let paidSum = 0;
  for (const order of orders) {
    if (!isOrderChecked(order)) continue;
    count += 1;
    const amount = parseLooseNumber(order.amount);
    if (amount != null) sum += amount;
    const paidAmount = getOrderPaidAmount(order);
    if (paidAmount > 0) {
      paidSum += paidAmount;
    }
  }

  countEl.textContent = String(count);
  sumEl.textContent = count ? `${formatAmountWholeRubles(sum)}\u00A0₽` : "—";
  if (paidSumEl) {
    paidSumEl.textContent = paidSum > 0 ? `${formatAmountWholeRubles(paidSum)}\u00A0₽` : "—";
  }
  if (salaryResultEl) {
    if (count) {
      const salary = MANAGER_SALARY_BASE + sum * MANAGER_SALARY_COST_RATE;
      salaryResultEl.textContent = `${formatAmountWholeRubles(salary)}\u00A0₽`;
    } else {
      salaryResultEl.textContent = "—";
    }
  }
}

function buildRowHtml(order) {
  const filesCount = state.filesCountMap[order.id] || 0;
  const phone = order.phone ?? "";
  const client = order.client ?? "";
  const address = order.address ?? "";
  const description = order.description ?? "";
  const hasPhone = Boolean((phone || "").trim());
  const orderIdChipClasses = ["status-value", "order-id-chip"];
  if (filesCount > 0) orderIdChipClasses.push("order-id-chip--has-files");
  if (hasPhone) orderIdChipClasses.push("order-id-chip--has-phone");
  if (isOrderEditLockedForUserLite(order)) orderIdChipClasses.push("order-id-chip--lock-user-lite");
  if (orderHasActiveTask(order.id)) orderIdChipClasses.push("order-id-chip--highlight-tasks");

  const orderNumberDisplay =
    order.id != null ? escapeHtml(formatOrderIdTypeChip(order.id, order.order_type)) : "";
  const statusDisplayText =
    order.payment_status === "нет" ? "Контакт с клиентом" : (order.payment_status ?? "Контакт с клиентом");
  const checked = isOrderChecked(order) ? " checked" : "";
  const disabled = canSaveManagerSalaryChecks() ? "" : " disabled";
  const idAttr = escapeAttr(orderIdKey(order));

  return `
    <tr>
      <td class="td-manager-salary-check">
        <input
          type="checkbox"
          class="manager-salary-row-check"
          data-order-id="${idAttr}"
          aria-label="Учитывать заказ в расчёте"
          ${checked}${disabled}
        />
      </td>
      <td class="td-order-id" data-order-id="${order.id ?? ""}" data-phone="${escapeAttr(phone)}" data-files-count="${filesCount}" data-lock-edit-user-lite="${isOrderEditLockedForUserLite(order) ? "1" : "0"}">
        <span class="${orderIdChipClasses.join(" ")}">${orderNumberDisplay}</span>
      </td>
      <td class="td-order-date">${formatDateShortRU(order.order_date)}</td>
      <td class="td-order-client" data-fulltext="${escapeAttr(client)}">${client ? `<span class="status-value">${escapeHtml(client)}</span>` : ""}</td>
      <td class="td-paid">${paidBadge(order)}</td>
      <td class="td-order-address" data-fulltext="${escapeAttr(address)}">${address ? `<span class="status-value">${escapeHtml(address)}</span>` : ""}</td>
      <td class="td-order-description" data-fulltext="${escapeAttr(description)}">${description ? `<span class="status-value">${escapeHtml(description)}</span>` : ""}</td>
      <td class="td-order-status" data-fulltext="${escapeAttr(statusDisplayText)}"><span class="status-value">${escapeHtml(statusDisplayText)}</span></td>
      <td class="td-money td-main-amount">${order.amount != null && order.amount !== "" ? `<span class="status-value">${formatAmount(order.amount)}</span>` : ""}</td>
      <td class="td-prepayment td-money">${order.prepayment != null && order.prepayment !== "" ? `<span class="status-value">${formatAmount(order.prepayment)}</span>` : ""}</td>
      <td class="td-prepayment-to">${order.prepayment_to ? escapeHtml(order.prepayment_to) : ""}</td>
      <td class="td-remaining td-money">${
        order.remaining_amount != null && order.remaining_amount !== ""
          ? order.remaining_to || isRemainingAmountZero(order)
            ? `<span class="installer-paid-value">${formatAmount(order.remaining_amount)}</span>`
            : isOplahenoPaidNoAlert(order)
              ? `<span class="paid-no-alert">${formatAmount(order.remaining_amount)}</span>`
              : `<span class="status-value">${formatAmount(order.remaining_amount)}</span>`
          : ""
      }</td>
      <td class="td-remaining-to">${order.remaining_to ? escapeHtml(order.remaining_to) : ""}</td>
    </tr>
  `;
}

function applyCellTitles(tbody) {
  tbody.querySelectorAll(".td-order-client, .td-order-address, .td-order-description, .td-order-status").forEach((cell) => {
    const full = cell.getAttribute("data-fulltext");
    if (!full) return;
    const chip = cell.querySelector(".status-value");
    const truncated =
      chip && chip.scrollWidth > chip.clientWidth + 0.5
        ? true
        : cell.scrollWidth > cell.clientWidth + 0.5;
    if (truncated) cell.setAttribute("title", full);
    else cell.removeAttribute("title");
  });
}

function applyUncheckedIds(ids) {
  uncheckedOrderIds.clear();
  savedUncheckedOrderIds.clear();
  for (const id of ids) {
    const s = String(id);
    uncheckedOrderIds.add(s);
    savedUncheckedOrderIds.add(s);
  }
}

async function fetchUncheckedValue(key) {
  const { data, error } = await supabaseClient
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  return { data, error };
}

/**
 * Можно ли подставить сохранённый выбор за месяц целиком:
 * период начинается с 1-го числа и не выходит за пределы одного месяца.
 */
function monthFallbackKey(fromYmd, toYmd) {
  if (!isValidYmd(fromYmd) || !isValidYmd(toYmd)) return null;
  if (fromYmd.slice(0, 7) !== toYmd.slice(0, 7)) return null;
  if (fromYmd.slice(8, 10) !== "01") return null;
  return fromYmd.slice(0, 7);
}

async function loadUncheckedForPeriod(fromYmd, toYmd) {
  const token = ++loadToken;
  const pKey = periodKey(fromYmd, toYmd);
  const key = settingsKeyForPeriod(fromYmd, toYmd);

  let { data, error } = await fetchUncheckedValue(key);

  if (token !== loadToken || periodKey(selectedDateFrom, selectedDateTo) !== pKey) return;

  if (error) {
    applyUncheckedIds([]);
    loadedPeriodKey = pKey;
    setSaveMessage("Не удалось загрузить сохранённый выбор", true);
    updateSaveButtonState();
    return;
  }

  let ids = parseUncheckedIds(data?.value);

  // Обратная совместимость: старые ключи manager_salary_unchecked_YYYY-MM
  if (ids.length === 0 && (data?.value == null || data?.value === "")) {
    const monthKey = monthFallbackKey(fromYmd, toYmd);
    if (monthKey) {
      const legacy = await fetchUncheckedValue(settingsKeyForMonth(monthKey));
      if (token !== loadToken || periodKey(selectedDateFrom, selectedDateTo) !== pKey) return;
      if (!legacy.error) {
        ids = parseUncheckedIds(legacy.data?.value);
      }
    }
  }

  applyUncheckedIds(ids);
  loadedPeriodKey = pKey;
  setSaveMessage("");
  updateSaveButtonState();
}

async function saveUncheckedSelection() {
  if (saveInFlight) return;
  if (!canSaveManagerSalaryChecks()) {
    setSaveMessage("Сохранение доступно только ролям admin и user", true);
    updateSaveButtonState();
    return;
  }

  const orders = getManagerSalaryOrders();
  const visibleIds = new Set(orders.map(orderIdKey));
  if (setsEqualForVisible(uncheckedOrderIds, savedUncheckedOrderIds, visibleIds)) {
    updateSaveButtonState();
    return;
  }

  const ids = visibleUncheckedIds(visibleIds);
  const fromYmd = selectedDateFrom;
  const toYmd = selectedDateTo;
  const pKey = periodKey(fromYmd, toYmd);
  const key = settingsKeyForPeriod(fromYmd, toYmd);
  const value = JSON.stringify(ids);

  saveInFlight = true;
  updateSaveButtonState();
  setSaveMessage("Сохранение…");

  const { error } = await supabaseClient
    .from("app_settings")
    .upsert({ key, value }, { onConflict: "key" });

  saveInFlight = false;

  if (periodKey(selectedDateFrom, selectedDateTo) !== pKey) {
    updateSaveButtonState();
    return;
  }

  if (error) {
    setSaveMessage("Не удалось сохранить выбор", true);
    updateSaveButtonState();
    return;
  }

  savedUncheckedOrderIds.clear();
  for (const id of ids) savedUncheckedOrderIds.add(id);
  setSaveMessage("Выбор сохранён");
  updateSaveButtonState();
}

export function renderManagerSalary() {
  if (!isValidYmd(selectedDateFrom)) selectedDateFrom = defaultDateFromYmd();
  if (!isValidYmd(selectedDateTo)) selectedDateTo = defaultDateToYmd();
  if (selectedDateFrom > selectedDateTo) {
    const tmp = selectedDateFrom;
    selectedDateFrom = selectedDateTo;
    selectedDateTo = tmp;
  }
  syncDateInputs();

  const tbody = document.querySelector("#managerSalaryTable tbody");
  const emptyEl = document.getElementById("managerSalaryEmpty");
  if (!tbody) return;

  const orders = getManagerSalaryOrders();
  const visibleIds = new Set(orders.map(orderIdKey));
  for (const id of Array.from(uncheckedOrderIds)) {
    if (!visibleIds.has(id)) uncheckedOrderIds.delete(id);
  }

  if (orders.length === 0) {
    tbody.innerHTML = "";
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.textContent = `Нет заказов за период ${formatPeriodLabel(selectedDateFrom, selectedDateTo)} со статусом «Производство» и далее (включая закрытые).`;
    }
    updateSummary([]);
    updateSaveButtonState();
    return;
  }

  if (emptyEl) emptyEl.hidden = true;
  tbody.innerHTML = orders.map(buildRowHtml).join("");
  updateSummary(orders);
  updateSaveButtonState();

  requestAnimationFrame(() => applyCellTitles(tbody));
}

export async function loadManagerSalary() {
  initManagerSalarySection();
  readAndNormalizeDateRange();
  const pKey = periodKey(selectedDateFrom, selectedDateTo);
  if (loadedPeriodKey !== pKey) {
    await loadUncheckedForPeriod(selectedDateFrom, selectedDateTo);
  }
  renderManagerSalary();
}

async function onPeriodChange() {
  readAndNormalizeDateRange();
  await loadUncheckedForPeriod(selectedDateFrom, selectedDateTo);
  renderManagerSalary();
}

function onTableChange(e) {
  const checkbox = e.target?.closest?.("input.manager-salary-row-check");
  if (!checkbox) return;
  if (!canSaveManagerSalaryChecks()) {
    // Вернуть визуально к сохранённому состоянию, если роль не может менять выбор.
    const id = checkbox.getAttribute("data-order-id");
    if (id) checkbox.checked = !uncheckedOrderIds.has(id);
    return;
  }
  const id = checkbox.getAttribute("data-order-id");
  if (!id) return;
  if (checkbox.checked) uncheckedOrderIds.delete(id);
  else uncheckedOrderIds.add(id);
  setSaveMessage("");
  updateSummary(getManagerSalaryOrders());
  updateSaveButtonState();
}

export function initManagerSalarySection() {
  if (bound) return;
  bound = true;

  const fromEl = document.getElementById("managerSalaryDateFrom");
  const toEl = document.getElementById("managerSalaryDateTo");
  if (fromEl && !fromEl.value) fromEl.value = defaultDateFromYmd();
  if (toEl && !toEl.value) toEl.value = defaultDateToYmd();
  readAndNormalizeDateRange();

  const onChange = () => {
    void onPeriodChange();
  };
  if (fromEl) fromEl.addEventListener("change", onChange);
  if (toEl) toEl.addEventListener("change", onChange);

  const table = document.getElementById("managerSalaryTable");
  if (table) {
    table.addEventListener("change", onTableChange);
  }

  const saveBtn = document.getElementById("managerSalarySaveChecksBtn");
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      void saveUncheckedSelection();
    });
  }

  const refreshIfActive = () => {
    if (document.getElementById("section-manager-salary")?.classList.contains("active")) {
      renderManagerSalary();
    }
  };

  document.addEventListener("orders-filters-updated", refreshIfActive);
  document.addEventListener("orders-table-will-render", refreshIfActive);
}
