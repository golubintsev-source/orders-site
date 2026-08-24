import { state } from "./state.js";
import { formatAmount } from "./format.js";
import { isOrderHiddenForCurrentRole } from "./roles.js";
import { DEBT_STATUSES, buildDebtsMatrix } from "./debts-matrix.js";

export { DEBT_STATUSES, buildDebtsMatrix };

function escapeHtml(s) {
  if (s == null) return "";
  const div = document.createElement("div");
  div.textContent = String(s);
  return div.innerHTML;
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
    return `<tr>
      <th scope="row">${escapeHtml(status)}</th>
      ${moneyCell(b.all)}
      ${moneyCell(b.over1m)}
      ${moneyCell(b.over3m)}
    </tr>`;
  });
  rows.push(`<tr class="debts-total-row">
      <th scope="row">Всё</th>
      ${moneyCell(matrix.total.all)}
      ${moneyCell(matrix.total.over1m)}
      ${moneyCell(matrix.total.over3m)}
    </tr>`);
  tbody.innerHTML = rows.join("");
}

export function loadDebts() {
  const tbody = document.querySelector("#debtsTable tbody");
  if (!tbody) return;
  const orders = (state.allOrders || []).filter((order) => !isOrderHiddenForCurrentRole(order));
  paintDebtsTable(buildDebtsMatrix(orders));
}

let debtsSectionBound = false;

export function initDebtsSection() {
  if (debtsSectionBound) return;
  debtsSectionBound = true;
  const refreshIfActive = () => {
    if (document.getElementById("section-debts")?.classList.contains("active")) {
      loadDebts();
    }
  };
  document.addEventListener("orders-filters-updated", refreshIfActive);
  document.addEventListener("orders-table-will-render", refreshIfActive);
  refreshIfActive();
}
