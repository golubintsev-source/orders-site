import { state } from "./state.js";
import { isOrderHiddenForCurrentRole, isOrderEditLockedForUserLite, isShopOrder } from "./roles.js";
import { formatAmount, formatAmountWholeRubles, formatDateShortRU, formatOrderIdTypeChip } from "./format.js";

/** Статусы с «Производство» и далее, включая «Заказ закрыт». */
const MANAGER_SALARY_STATUSES = new Set([
  "Производство",
  "Товар передан заказчику",
  "Монтаж выполнен",
  "Заказ закрыт",
]);

const MONTH_NAMES_RU = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

/** Выбранный месяц YYYY-MM; по умолчанию — текущий. */
let selectedMonthKey = currentMonthKey();

/** id заказов, снятых с учёта (чекбокс снят). По умолчанию все учтены. */
const uncheckedOrderIds = new Set();

let bound = false;

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
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

function monthKeyFromYmd(ymd) {
  if (!ymd || ymd.length < 7) return null;
  return ymd.slice(0, 7);
}

function formatMonthLabel(monthKey) {
  const [y, m] = String(monthKey).split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return String(monthKey);
  return `${MONTH_NAMES_RU[m - 1]} ${y}`;
}

/** Список месяцев для выбора: от заказов + минимум 36 месяцев назад до текущего. */
function buildMonthOptions() {
  const keys = new Set();
  const current = currentMonthKey();
  keys.add(current);

  for (const order of state.allOrders || []) {
    if (isOrderHiddenForCurrentRole(order)) continue;
    const ymd = getOrderCalendarYmd(order);
    const mk = monthKeyFromYmd(ymd);
    if (mk) keys.add(mk);
  }

  const now = new Date();
  for (let i = 0; i < 36; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  return Array.from(keys).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

function fillMonthSelect() {
  const select = document.getElementById("managerSalaryMonthSelect");
  if (!select) return;

  const options = buildMonthOptions();
  if (!options.includes(selectedMonthKey)) {
    selectedMonthKey = currentMonthKey();
  }

  const prev = select.value;
  select.innerHTML = "";
  for (const key of options) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = formatMonthLabel(key);
    if (key === selectedMonthKey) opt.selected = true;
    select.appendChild(opt);
  }

  if (prev && options.includes(prev) && prev === selectedMonthKey) {
    select.value = prev;
  } else {
    select.value = selectedMonthKey;
  }
}

function getManagerSalaryOrders() {
  const list = (state.allOrders || []).filter((order) => {
    if (isOrderHiddenForCurrentRole(order)) return false;
    if (isShopOrder(order)) return false;
    const status = normalizeStatus(order.payment_status);
    if (!MANAGER_SALARY_STATUSES.has(status)) return false;
    const ymd = getOrderCalendarYmd(order);
    const mk = monthKeyFromYmd(ymd);
    return mk === selectedMonthKey;
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

function updateSummary(orders) {
  const countEl = document.getElementById("managerSalaryCount");
  const sumEl = document.getElementById("managerSalarySum");
  const paidSumEl = document.getElementById("managerSalaryPaidSum");
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
  const tasksHighlight =
    order.tasks_highlight === true ||
    order.tasks_highlight === 1 ||
    order.tasks_highlight === "1";
  if (tasksHighlight) orderIdChipClasses.push("order-id-chip--highlight-tasks");

  const orderNumberDisplay =
    order.id != null ? escapeHtml(formatOrderIdTypeChip(order.id, order.order_type)) : "";
  const statusDisplayText =
    order.payment_status === "нет" ? "Контакт с клиентом" : (order.payment_status ?? "Контакт с клиентом");
  const checked = isOrderChecked(order) ? " checked" : "";
  const idAttr = escapeAttr(orderIdKey(order));

  return `
    <tr>
      <td class="td-manager-salary-check">
        <input
          type="checkbox"
          class="manager-salary-row-check"
          data-order-id="${idAttr}"
          aria-label="Учитывать заказ в расчёте"
          ${checked}
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

export function renderManagerSalary() {
  if (!selectedMonthKey) selectedMonthKey = currentMonthKey();
  fillMonthSelect();

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
      emptyEl.textContent = `Нет заказов за ${formatMonthLabel(selectedMonthKey)} со статусом «Производство» и далее (включая закрытые).`;
    }
    updateSummary([]);
    return;
  }

  if (emptyEl) emptyEl.hidden = true;
  tbody.innerHTML = orders.map(buildRowHtml).join("");
  updateSummary(orders);

  requestAnimationFrame(() => applyCellTitles(tbody));
}

export function loadManagerSalary() {
  initManagerSalarySection();
  if (!selectedMonthKey) selectedMonthKey = currentMonthKey();
  renderManagerSalary();
}

function onMonthChange(e) {
  const value = e.target?.value;
  if (!value) return;
  selectedMonthKey = value;
  uncheckedOrderIds.clear();
  renderManagerSalary();
}

function onTableChange(e) {
  const checkbox = e.target?.closest?.("input.manager-salary-row-check");
  if (!checkbox) return;
  const id = checkbox.getAttribute("data-order-id");
  if (!id) return;
  if (checkbox.checked) uncheckedOrderIds.delete(id);
  else uncheckedOrderIds.add(id);
  updateSummary(getManagerSalaryOrders());
}

export function initManagerSalarySection() {
  if (bound) return;
  bound = true;

  const select = document.getElementById("managerSalaryMonthSelect");
  if (select) {
    select.addEventListener("change", onMonthChange);
  }

  const table = document.getElementById("managerSalaryTable");
  if (table) {
    table.addEventListener("change", onTableChange);
  }

  const refreshIfActive = () => {
    if (document.getElementById("section-manager-salary")?.classList.contains("active")) {
      renderManagerSalary();
    }
  };

  document.addEventListener("orders-filters-updated", refreshIfActive);
  document.addEventListener("orders-table-will-render", refreshIfActive);
}
