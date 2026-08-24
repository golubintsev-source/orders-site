import { state } from "./state.js";
import { formatAmount } from "./format.js";
import { isOrderHiddenForCurrentRole, isUserLite, isUserShop } from "./roles.js";
import { DEBT_STATUSES, buildDebtsMatrix, orderMatchesOrderTypeKeys } from "./debts-matrix.js";

export { DEBT_STATUSES, buildDebtsMatrix, orderMatchesOrderTypeKeys };

const BLUE_FILL_STATUSES = new Set(["Товар передан заказчику", "Монтаж выполнен"]);

/** Те же ключи, что у фильтра колонки «Номер» на странице заказов. */
const ORDER_TYPE_FILTER_KEYS = ["__empty__", "Окна", "Подоконники", "Аллюминий", "Магазин", "Сетки/мелочь"];

/** выбранные типы; пустой массив = все */
let debtsOrderTypeFilterSelected = [];
let debtsFilterDocCloseBound = false;

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

function moneyCell(amount) {
  const text = formatAmount(amount);
  return `<td class="td-money">${text ? `<span class="status-value">${escapeHtml(text)}</span>` : "—"}</td>`;
}

function paintDebtsTable(matrix) {
  const tbody = document.querySelector("#debtsTable tbody");
  if (!tbody) return;
  const rows = DEBT_STATUSES.map((status) => {
    const b = matrix.byStatus[status];
    const rowClass = BLUE_FILL_STATUSES.has(status) ? ' class="debts-row-blue"' : "";
    return `<tr${rowClass}>
      <th scope="row">${escapeHtml(status)}</th>
      ${moneyCell(b.all)}
      ${moneyCell(b.over1m)}
      ${moneyCell(b.over3m)}
    </tr>`;
  });
  rows.push(`<tr class="debts-total-row">
      <th scope="row">все</th>
      ${moneyCell(matrix.total.all)}
      ${moneyCell(matrix.total.over1m)}
      ${moneyCell(matrix.total.over3m)}
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
  const refreshIfActive = () => {
    if (document.getElementById("section-debts")?.classList.contains("active")) {
      loadDebts();
    }
  };
  document.addEventListener("orders-filters-updated", refreshIfActive);
  document.addEventListener("orders-table-will-render", refreshIfActive);
  refreshIfActive();
}
