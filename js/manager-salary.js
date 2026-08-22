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
import { getManagerSalaryParams } from "./settings.js";

/** Статусы с «Производство» и далее, включая «Заказ закрыт». */
const MANAGER_SALARY_STATUSES = new Set([
  "Производство",
  "Товар передан заказчику",
  "Монтаж выполнен",
  "Заказ закрыт",
]);

/**
 * Префикс ключа в app_settings: manager_salary_unchecked_[<manager>_]YYYY-MM-DD_YYYY-MM-DD.
 * Для менеджера по умолчанию суффикса нет — ключи, сохранённые до фильтра, продолжают работать.
 */
const SETTINGS_KEY_PREFIX = "manager_salary_unchecked_";

/**
 * Менеджеры и их заказы: Кристине принадлежат все заказы, кроме типа «Магазин»,
 * Андрею — заказы типа «Магазин».
 */
const MANAGERS = [
  { id: "kristina", name: "Кристина", ownsOrder: (order) => !isShopOrder(order) },
  { id: "andrey", name: "Андрей", ownsOrder: (order) => isShopOrder(order) },
];

/** Менеджер по умолчанию; для него ключ в app_settings остаётся без суффикса. */
const DEFAULT_MANAGER_ID = "kristina";

let selectedManagerId = DEFAULT_MANAGER_ID;

/** Выбранный период YYYY-MM-DD; по умолчанию — с 1-го числа текущего месяца по сегодня. */
let selectedFromYmd = "";
let selectedToYmd = "";

/** id заказов, снятых с учёта (чекбокс снят). По умолчанию все учтены. */
const uncheckedOrderIds = new Set();

/** Последнее сохранённое в БД состояние снятых чекбоксов для текущего менеджера и периода. */
const savedUncheckedOrderIds = new Set();

/** Менеджер и период, для которых уже загружены сохранённые чекбоксы. */
let loadedSelectionKey = null;

let bound = false;
let saveInFlight = false;
let loadToken = 0;

function localDateToYmd(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function defaultPeriodRange() {
  const now = new Date();
  const fromYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  return { fromYmd, toYmd: localDateToYmd(now) };
}

function ensureDefaultPeriod() {
  if (selectedFromYmd && selectedToYmd) return;
  const { fromYmd, toYmd } = defaultPeriodRange();
  selectedFromYmd = fromYmd;
  selectedToYmd = toYmd;
}

function getManagerById(managerId) {
  return MANAGERS.find((m) => m.id === managerId) || MANAGERS[0];
}

function selectionKey(managerId, fromYmd, toYmd) {
  return `${managerId}_${fromYmd}_${toYmd}`;
}

function currentSelectionKey() {
  return selectionKey(selectedManagerId, selectedFromYmd, selectedToYmd);
}

function settingsKeyForSelection(managerId, fromYmd, toYmd) {
  const suffix = managerId === DEFAULT_MANAGER_ID ? "" : `${managerId}_`;
  return `${SETTINGS_KEY_PREFIX}${suffix}${fromYmd}_${toYmd}`;
}

function isValidYmd(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return (
    !Number.isNaN(dt.getTime()) &&
    dt.getFullYear() === y &&
    dt.getMonth() === m - 1 &&
    dt.getDate() === d
  );
}

function formatYmdShortRU(ymd) {
  if (!isValidYmd(ymd)) return ymd || "";
  const [, m, d] = ymd.split("-").map(Number);
  const months = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  return `${d} ${months[m - 1]}`;
}

function formatPeriodLabel(fromYmd, toYmd) {
  return `с ${formatYmdShortRU(fromYmd)} по ${formatYmdShortRU(toYmd)}`;
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

function fillFilterInputs() {
  ensureDefaultPeriod();
  const fromEl = document.getElementById("managerSalaryDateFrom");
  const toEl = document.getElementById("managerSalaryDateTo");
  const managerEl = document.getElementById("managerSalaryManager");
  if (fromEl) fromEl.value = selectedFromYmd;
  if (toEl) toEl.value = selectedToYmd;
  if (managerEl) managerEl.value = selectedManagerId;
}

function readFilterInputs() {
  const fromEl = document.getElementById("managerSalaryDateFrom");
  const toEl = document.getElementById("managerSalaryDateTo");
  const managerEl = document.getElementById("managerSalaryManager");
  return {
    fromYmd: (fromEl?.value ?? "").trim(),
    toYmd: (toEl?.value ?? "").trim(),
    managerId: getManagerById((managerEl?.value ?? "").trim()).id,
  };
}

function getManagerSalaryOrders() {
  ensureDefaultPeriod();
  if (!isValidYmd(selectedFromYmd) || !isValidYmd(selectedToYmd) || selectedFromYmd > selectedToYmd) {
    return [];
  }

  const manager = getManagerById(selectedManagerId);
  const list = (state.allOrders || []).filter((order) => {
    if (isOrderHiddenForCurrentRole(order)) return false;
    if (!manager.ownsOrder(order)) return false;
    const status = normalizeStatus(order.payment_status);
    if (!MANAGER_SALARY_STATUSES.has(status)) return false;
    const ymd = getOrderCalendarYmd(order);
    if (!ymd) return false;
    return ymd >= selectedFromYmd && ymd <= selectedToYmd;
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

function formatPercentForFormula(percent) {
  const n = Number(percent);
  if (!Number.isFinite(n)) return "0%";
  const rounded = Math.round(n * 10000) / 10000;
  return `${String(rounded).replace(".", ",")}%`;
}

function updateFormulaDisplay(base, percent, resultText) {
  const formulaTextEl = document.getElementById("managerSalaryFormulaText");
  const salaryResultEl = document.getElementById("managerSalaryResult");
  const baseLabel = formatAmountWholeRubles(base);
  const percentLabel = formatPercentForFormula(percent);
  if (formulaTextEl) {
    formulaTextEl.textContent = `Зарплата = ${baseLabel} + Стоимость × ${percentLabel} =`;
  }
  if (salaryResultEl) {
    salaryResultEl.textContent = resultText;
  }
}

function updateSummary(orders) {
  const countEl = document.getElementById("managerSalaryCount");
  const sumEl = document.getElementById("managerSalarySum");
  const paidSumEl = document.getElementById("managerSalaryPaidSum");
  if (!countEl || !sumEl) return;

  const { base, percent } = getManagerSalaryParams(selectedManagerId);
  const rate = percent / 100;

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
  const resultText = count
    ? `${formatAmountWholeRubles(base + sum * rate)}\u00A0₽`
    : "—";
  updateFormulaDisplay(base, percent, resultText);
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

async function loadUncheckedForSelection(managerId, fromYmd, toYmd) {
  const token = ++loadToken;
  const key = settingsKeyForSelection(managerId, fromYmd, toYmd);
  const expectedSelection = selectionKey(managerId, fromYmd, toYmd);

  const { data, error } = await supabaseClient
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  if (token !== loadToken || currentSelectionKey() !== expectedSelection) return;

  if (error) {
    applyUncheckedIds([]);
    loadedSelectionKey = expectedSelection;
    setSaveMessage("Не удалось загрузить сохранённый выбор", true);
    updateSaveButtonState();
    return;
  }

  applyUncheckedIds(parseUncheckedIds(data?.value));
  loadedSelectionKey = expectedSelection;
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

  ensureDefaultPeriod();
  if (!isValidYmd(selectedFromYmd) || !isValidYmd(selectedToYmd) || selectedFromYmd > selectedToYmd) {
    setSaveMessage("Укажите корректный период.", true);
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
  const key = settingsKeyForSelection(selectedManagerId, selectedFromYmd, selectedToYmd);
  const value = JSON.stringify(ids);
  const expectedSelection = currentSelectionKey();

  saveInFlight = true;
  updateSaveButtonState();
  setSaveMessage("Сохранение…");

  const { error } = await supabaseClient
    .from("app_settings")
    .upsert({ key, value }, { onConflict: "key" });

  saveInFlight = false;

  if (currentSelectionKey() !== expectedSelection) {
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
  ensureDefaultPeriod();
  fillFilterInputs();

  const tbody = document.querySelector("#managerSalaryTable tbody");
  const emptyEl = document.getElementById("managerSalaryEmpty");
  if (!tbody) return;

  if (!isValidYmd(selectedFromYmd) || !isValidYmd(selectedToYmd)) {
    tbody.innerHTML = "";
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.textContent = "Укажите обе даты периода.";
    }
    updateSummary([]);
    updateSaveButtonState();
    return;
  }

  if (selectedFromYmd > selectedToYmd) {
    tbody.innerHTML = "";
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.textContent = "Дата «с» не может быть позже даты «по».";
    }
    updateSummary([]);
    updateSaveButtonState();
    return;
  }

  const orders = getManagerSalaryOrders();
  const visibleIds = new Set(orders.map(orderIdKey));
  for (const id of Array.from(uncheckedOrderIds)) {
    if (!visibleIds.has(id)) uncheckedOrderIds.delete(id);
  }

  if (orders.length === 0) {
    tbody.innerHTML = "";
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.textContent = `Нет заказов менеджера ${getManagerById(selectedManagerId).name} ${formatPeriodLabel(selectedFromYmd, selectedToYmd)} со статусом «Производство» и далее (включая закрытые).`;
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
  ensureDefaultPeriod();
  fillFilterInputs();
  if (loadedSelectionKey !== currentSelectionKey()) {
    await loadUncheckedForSelection(selectedManagerId, selectedFromYmd, selectedToYmd);
  }
  renderManagerSalary();
}

async function onFiltersChange() {
  const { fromYmd, toYmd, managerId } = readFilterInputs();
  selectedManagerId = managerId;
  selectedFromYmd = fromYmd;
  selectedToYmd = toYmd;

  if (!fromYmd || !toYmd || !isValidYmd(fromYmd) || !isValidYmd(toYmd) || fromYmd > toYmd) {
    renderManagerSalary();
    return;
  }

  await loadUncheckedForSelection(selectedManagerId, selectedFromYmd, selectedToYmd);
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

  ensureDefaultPeriod();
  fillFilterInputs();

  const fromEl = document.getElementById("managerSalaryDateFrom");
  const toEl = document.getElementById("managerSalaryDateTo");
  const managerEl = document.getElementById("managerSalaryManager");
  const onChange = () => {
    void onFiltersChange();
  };
  if (fromEl) fromEl.addEventListener("change", onChange);
  if (toEl) toEl.addEventListener("change", onChange);
  if (managerEl) managerEl.addEventListener("change", onChange);

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
  document.addEventListener("manager-salary-params-updated", refreshIfActive);
}
