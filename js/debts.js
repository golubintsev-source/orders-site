import { state } from "./state.js";
import { formatAmount, formatDateShortRU, formatOrderIdTypeChip } from "./format.js";
import { isOrderHiddenForCurrentRole, isUserLite, isUserShop } from "./roles.js";
import {
  DEBT_STATUSES,
  buildDebtsMatrix,
  getDebtCellOrders,
  orderMatchesOrderTypeKeys,
} from "./debts-matrix.js";
import { downloadXlsxBuffer } from "./xlsxDownload.js";
import { ensureXlsx } from "./lazy-cdn.js";

export { DEBT_STATUSES, buildDebtsMatrix, orderMatchesOrderTypeKeys };

const BLUE_FILL_STATUSES = new Set(["Товар передан заказчику", "Монтаж выполнен"]);

/** Те же ключи, что у фильтра колонки «Номер» на странице заказов. */
const ORDER_TYPE_FILTER_KEYS = ["__empty__", "Окна", "Подоконники", "Аллюминий", "Магазин", "Сетки/мелочь"];

const BUCKET_LABELS = {
  all: "все",
  over1m: "Более 1 месяца",
  over3m: "Более 3 месяцев",
};

const POPUP_TABLE_HEADERS = [
  "Номер",
  "Дата",
  "Клиент",
  "Адрес",
  "Статус",
  "Стоимость",
  "Предоплата",
  "Остаток",
  "Кому",
  "Телефон",
];

/** выбранные типы; пустой массив = все */
let debtsOrderTypeFilterSelected = [];
let debtsFilterDocCloseBound = false;
let lastDebtsMatrix = null;
/** @type {object[]} */
let popupOrders = [];

function escapeHtml(s) {
  if (s == null) return "";
  const div = document.createElement("div");
  div.textContent = String(s);
  return div.innerHTML;
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

function orderTypeFilterKeysForUi() {
  if (isUserShop()) return ["Магазин"];
  if (isUserLite()) return ORDER_TYPE_FILTER_KEYS.filter((k) => k !== "Магазин");
  return ORDER_TYPE_FILTER_KEYS;
}

function orderTypeFilterLabel(key) {
  return key === "__empty__" ? "Без типа" : key;
}

function moneyCell(amount, statusKey, bucket) {
  const text = formatAmount(amount);
  if (!text) return `<td class="td-money">—</td>`;
  return `<td class="td-money"><button type="button" class="debts-amount-link status-value" data-debt-status="${escapeAttr(
    statusKey,
  )}" data-debt-bucket="${escapeAttr(bucket)}">${escapeHtml(text)}</button></td>`;
}

function paintDebtsTable(matrix) {
  const tbody = document.querySelector("#debtsTable tbody");
  if (!tbody) return;
  lastDebtsMatrix = matrix;
  const rows = DEBT_STATUSES.map((status) => {
    const b = matrix.byStatus[status];
    const rowClass = BLUE_FILL_STATUSES.has(status) ? ' class="debts-row-blue"' : "";
    return `<tr${rowClass}>
      <th scope="row">${escapeHtml(status)}</th>
      ${moneyCell(b.all, status, "all")}
      ${moneyCell(b.over1m, status, "over1m")}
      ${moneyCell(b.over3m, status, "over3m")}
    </tr>`;
  });
  rows.push(`<tr class="debts-total-row">
      <th scope="row">все</th>
      ${moneyCell(matrix.total.all, "все", "all")}
      ${moneyCell(matrix.total.over1m, "все", "over1m")}
      ${moneyCell(matrix.total.over3m, "все", "over3m")}
    </tr>`);
  tbody.innerHTML = rows.join("");
}

function syncDebtsFilterBtnActive() {
  const btn = document.getElementById("debtsOrderTypeFilterBtn");
  if (!btn) return;
  btn.classList.toggle("orders-filter-heading-btn--active", debtsOrderTypeFilterSelected.length > 0);
}

function closeDebtsOrderTypeFilterDropdown() {
  const dropdown = document.getElementById("debtsOrderTypeFilterDropdown");
  const btn = document.getElementById("debtsOrderTypeFilterBtn");
  if (dropdown) dropdown.style.display = "none";
  btn?.setAttribute("aria-expanded", "false");
}

function placeFilterDropdown(dropdown, anchorRect) {
  if (!dropdown) return;
  if (dropdown.parentNode !== document.body) {
    document.body.appendChild(dropdown);
  }
  dropdown.style.position = "fixed";
  dropdown.style.zIndex = "1200";
  dropdown.style.display = "block";
  dropdown.style.visibility = "hidden";

  const box = dropdown.getBoundingClientRect();
  const margin = 8;
  let left = anchorRect.left;
  let top = anchorRect.bottom + 4;
  if (left + box.width > window.innerWidth - margin) {
    left = Math.max(margin, window.innerWidth - box.width - margin);
  }
  if (left < margin) left = margin;
  if (top + box.height > window.innerHeight - margin) {
    top = Math.max(margin, anchorRect.top - box.height - 4);
  }
  dropdown.style.left = `${Math.round(left)}px`;
  dropdown.style.top = `${Math.round(top)}px`;
  dropdown.style.visibility = "";
}

function renderDebtsOrderTypeFilterDropdown() {
  const container = document.getElementById("debtsOrderTypeFilterCheckboxes");
  if (!container) return;
  const allSelected = debtsOrderTypeFilterSelected.length === 0;
  const keys = orderTypeFilterKeysForUi();
  const allHtml = `<label class="status-filter-item status-filter-all"><input type="checkbox" data-order-type-all="true" ${allSelected ? "checked" : ""}> все</label>`;
  const optionsHtml = keys
    .map((key) => {
      const checked = allSelected || debtsOrderTypeFilterSelected.includes(key);
      return `<label class="status-filter-item"><input type="checkbox" data-order-type="${escapeAttr(key)}" ${checked ? "checked" : ""}> ${escapeHtml(orderTypeFilterLabel(key))}</label>`;
    })
    .join("");
  container.innerHTML = allHtml + optionsHtml;
  container.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", onDebtsOrderTypeFilterChange);
  });
}

function onDebtsOrderTypeFilterChange(e) {
  const container = document.getElementById("debtsOrderTypeFilterCheckboxes");
  if (!container) return;
  const target = e.target;
  const allCb = container.querySelector('input[data-order-type-all="true"]');
  const typeCbs = container.querySelectorAll("input[type=checkbox][data-order-type]");

  if (target === allCb) {
    const checked = allCb.checked;
    typeCbs.forEach((cb) => {
      cb.checked = checked;
    });
    debtsOrderTypeFilterSelected = [];
    loadDebts();
    return;
  }

  const keys = orderTypeFilterKeysForUi();
  const checkedValues = Array.from(typeCbs)
    .filter((cb) => cb.checked)
    .map((el) => el.getAttribute("data-order-type"));
  debtsOrderTypeFilterSelected = checkedValues.length === keys.length ? [] : checkedValues;
  if (allCb) allCb.checked = checkedValues.length === keys.length;
  loadDebts();
}

function initDebtsOrderTypeFilter() {
  const btn = document.getElementById("debtsOrderTypeFilterBtn");
  const dropdown = document.getElementById("debtsOrderTypeFilterDropdown");
  if (!btn || !dropdown) return;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = dropdown.style.display === "block";
    if (isOpen) {
      closeDebtsOrderTypeFilterDropdown();
      return;
    }
    renderDebtsOrderTypeFilterDropdown();
    placeFilterDropdown(dropdown, btn.getBoundingClientRect());
    btn.setAttribute("aria-expanded", "true");
  });

  dropdown.addEventListener("click", (e) => e.stopPropagation());

  if (!debtsFilterDocCloseBound) {
    debtsFilterDocCloseBound = true;
    document.addEventListener("click", () => closeDebtsOrderTypeFilterDropdown());
  }
}

function moneyOrDash(val) {
  if (val == null || val === "") return "";
  return formatAmount(val);
}

function popupOrderCells(order) {
  const statusDisplay =
    order.payment_status === "нет" ? "Контакт с клиентом" : (order.payment_status ?? "Контакт с клиентом");
  return [
    order.id != null ? formatOrderIdTypeChip(order.id, order.order_type) : "",
    formatDateShortRU(order.order_date),
    order.client ?? "",
    order.address ?? "",
    statusDisplay,
    moneyOrDash(order.amount),
    moneyOrDash(order.prepayment),
    moneyOrDash(order.remaining_amount),
    order.remaining_to ? String(order.remaining_to) : "",
    order.phone ?? "",
  ];
}

function renderDebtsOrdersPopupTable(orders) {
  const tbody = document.getElementById("debtsOrdersPopupTbody");
  if (!tbody) return;
  if (!orders.length) {
    tbody.innerHTML = `<tr><td colspan="${POPUP_TABLE_HEADERS.length}" class="debts-orders-popup-empty">Нет заказов</td></tr>`;
    return;
  }
  tbody.innerHTML = orders
    .map((order) => {
      const cells = popupOrderCells(order)
        .map((v, i) => {
          const cls = i === 5 || i === 6 || i === 7 ? ' class="td-money"' : "";
          return `<td${cls}>${escapeHtml(v)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
}

function closeDebtsOrdersPopup() {
  const dialog = document.getElementById("debtsOrdersDialog");
  if (!dialog) return;
  if (typeof dialog.close === "function" && dialog.open) {
    dialog.close();
  }
}

function openDebtsOrdersPopup(statusKey, bucket) {
  const dialog = document.getElementById("debtsOrdersDialog");
  const titleEl = document.getElementById("debtsOrdersDialogTitle");
  const exportBtn = document.getElementById("debtsOrdersExportExcelBtn");
  if (!dialog) return;
  popupOrders = getDebtCellOrders(lastDebtsMatrix, statusKey, bucket);
  const bucketLabel = BUCKET_LABELS[bucket] || bucket;
  if (titleEl) {
    titleEl.textContent = `${statusKey} · ${bucketLabel} · ${popupOrders.length}`;
  }
  renderDebtsOrdersPopupTable(popupOrders);
  if (exportBtn) exportBtn.disabled = popupOrders.length === 0;
  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
  }
}

function excelFileNameTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

function applyAutoColumnWidths(ws, aoa) {
  if (!aoa.length) return;
  const numCols = Math.max(0, ...aoa.map((row) => row.length));
  const cols = [];
  for (let c = 0; c < numCols; c++) {
    let maxLen = 0;
    for (const row of aoa) {
      const v = row[c];
      if (v == null || v === "") continue;
      maxLen = Math.max(maxLen, String(v).length);
    }
    cols.push({ wch: Math.min(Math.max(maxLen + 2, 8), 255) });
  }
  ws["!cols"] = cols;
}

async function exportPopupOrdersToExcel() {
  const exportBtn = document.getElementById("debtsOrdersExportExcelBtn");
  if (!popupOrders.length) return;
  let XLSX;
  try {
    XLSX = await ensureXlsx();
  } catch (e) {
    console.error(e);
    return;
  }
  const { ORDERS_EXCEL_HEADERS, getOrderRowValuesForExcel } = await import("./orders.js");
  const rows = popupOrders.map((o) => getOrderRowValuesForExcel(o));
  const aoa = [ORDERS_EXCEL_HEADERS, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  applyAutoColumnWidths(ws, aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Заказы");
  const name = `dolgi_${excelFileNameTimestamp()}.xlsx`;
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  downloadXlsxBuffer(out, name);
  if (exportBtn) exportBtn.blur();
}

function initDebtsOrdersPopup() {
  const tbody = document.querySelector("#debtsTable tbody");
  const dialog = document.getElementById("debtsOrdersDialog");
  const closeBtn = document.getElementById("debtsOrdersDialogCloseBtn");
  const exportBtn = document.getElementById("debtsOrdersExportExcelBtn");
  tbody?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-debt-status][data-debt-bucket]");
    if (!btn || !tbody.contains(btn)) return;
    openDebtsOrdersPopup(btn.getAttribute("data-debt-status"), btn.getAttribute("data-debt-bucket"));
  });
  closeBtn?.addEventListener("click", () => closeDebtsOrdersPopup());
  exportBtn?.addEventListener("click", () => {
    void exportPopupOrdersToExcel();
  });
  dialog?.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeDebtsOrdersPopup();
  });
  dialog?.addEventListener("click", (e) => {
    if (e.target === dialog) closeDebtsOrdersPopup();
  });
}

export function loadDebts() {
  const tbody = document.querySelector("#debtsTable tbody");
  if (!tbody) return;
  const orders = (state.allOrders || []).filter((order) => {
    if (isOrderHiddenForCurrentRole(order)) return false;
    return orderMatchesOrderTypeKeys(order, debtsOrderTypeFilterSelected);
  });
  paintDebtsTable(buildDebtsMatrix(orders));
  syncDebtsFilterBtnActive();
}

let debtsSectionBound = false;

export function initDebtsSection() {
  if (debtsSectionBound) return;
  debtsSectionBound = true;
  initDebtsOrderTypeFilter();
  initDebtsOrdersPopup();
  const refreshIfActive = () => {
    if (document.getElementById("section-debts")?.classList.contains("active")) {
      loadDebts();
    }
  };
  document.addEventListener("orders-filters-updated", refreshIfActive);
  document.addEventListener("orders-table-will-render", refreshIfActive);
  refreshIfActive();
}
