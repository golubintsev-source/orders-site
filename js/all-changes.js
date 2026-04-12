import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import { formatOrderIdTypeChip, formatTaskDateRu } from "./format.js";
import { isOrderHiddenFromUserLite } from "./roles.js";
import { editOrder } from "./orders.js";
import { setDbUnavailableBannerVisible } from "./dbHealth.js";

function escapeHtml(s) {
  if (s == null) return "";
  const div = document.createElement("div");
  div.textContent = String(s);
  return div.innerHTML;
}

/** Первые 5 символов логина (без «…»). */
function formatLoginFive(raw) {
  if (raw == null || raw === "") return "—";
  const s = String(raw).trim();
  if (!s) return "—";
  return s.slice(0, 5);
}

export async function loadAllChanges() {
  const tbody = document.querySelector("#allChangesTable tbody");
  const msg = document.getElementById("allChangesMessage");
  if (!tbody) return;
  if (msg) {
    msg.textContent = "";
    msg.classList.remove("order-tasks-message--error");
  }

  const { data, error } = await supabaseClient
    .from("order_history")
    .select("created_at, user_email, comment, order_id")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Ошибка загрузки истории изменений:", error);
    setDbUnavailableBannerVisible(true);
    if (msg) {
      msg.textContent = "Не удалось загрузить изменения.";
      msg.classList.add("order-tasks-message--error");
    }
    tbody.innerHTML = "";
    return;
  }

  setDbUnavailableBannerVisible(false);

  const rows = data || [];
  const lines = [];
  for (const row of rows) {
    const orderType = state.allOrders?.find((o) => Number(o.id) === Number(row.order_id))?.order_type ?? "";
    if (isOrderHiddenFromUserLite({ order_type: orderType })) continue;

    const chip = formatOrderIdTypeChip(row.order_id, orderType);
    const oid = row.order_id != null ? String(row.order_id) : "";
    lines.push(`
    <tr class="all-changes-row" data-order-id="${escapeHtml(oid)}">
      <td>${escapeHtml(formatTaskDateRu(row.created_at))}</td>
      <td>${escapeHtml(formatLoginFive(row.user_email))}</td>
      <td>${escapeHtml(chip)}</td>
      <td class="all-changes-text-cell">${escapeHtml(row.comment || "")}</td>
    </tr>`);
  }
  tbody.innerHTML = lines.join("");

  if (lines.length === 0 && msg) {
    msg.textContent = "Пока нет записей об изменениях.";
  }
}

export function initAllChangesSection() {
  const table = document.getElementById("allChangesTable");
  if (!table) return;
  table.addEventListener("click", (e) => {
    const tr = e.target.closest("tbody tr");
    if (!tr || !table.contains(tr)) return;
    const raw = tr.getAttribute("data-order-id");
    const id = raw ? Number(raw) : NaN;
    if (Number.isNaN(id)) return;
    void editOrder(id);
  });
}
