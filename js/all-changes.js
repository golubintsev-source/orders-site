import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import { formatOrderIdTypeChip, formatTaskDateRu } from "./format.js";
import { isOrderHiddenFromUserLite } from "./roles.js";
import { setDbUnavailableBannerVisible } from "./dbHealth.js";
import { readSnapshot, persistOrderHistorySnapshot, mergeOrderHistoryRows } from "./offline-cache.js";

function escapeHtml(s) {
  if (s == null) return "";
  const div = document.createElement("div");
  div.textContent = String(s);
  return div.innerHTML;
}

/** Фильтрация строк таблицы по подстроке (без учёта регистра), по всем видимым ячейкам. */
function applyAllChangesFilter() {
  const input = document.getElementById("allChangesSearchInput");
  const tbody = document.querySelector("#allChangesTable tbody");
  if (!tbody) return;
  const q = (input?.value ?? "").trim().toLowerCase();
  const rows = tbody.querySelectorAll("tr.all-changes-row");
  for (const tr of rows) {
    if (!q) {
      tr.hidden = false;
      continue;
    }
    const haystack = (tr.textContent ?? "").toLowerCase();
    tr.hidden = !haystack.includes(q);
  }
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
    setDbUnavailableBannerVisible(true, { cacheMode: true });
    if (msg) {
      msg.textContent = "Показаны сохранённые на устройстве изменения; новые записи без сети — внизу с жёлтой заливкой.";
      msg.classList.remove("order-tasks-message--error");
    }
  } else {
    setDbUnavailableBannerVisible(false);
  }

  const baseRows = error ? readSnapshot()?.order_history || [] : data || [];
  if (!error && data) persistOrderHistorySnapshot(data);

  const rows = mergeOrderHistoryRows(baseRows);
  const lines = [];
  for (const row of rows) {
    const orderType = state.allOrders?.find((o) => Number(o.id) === Number(row.order_id))?.order_type ?? "";
    if (isOrderHiddenFromUserLite({ order_type: orderType })) continue;

    const chip = formatOrderIdTypeChip(row.order_id, orderType);
    const oid = row.order_id != null ? String(row.order_id) : "";
    const offlineCls = row.__offlinePendingSync ? " tr-order-offline-pending" : "";
    lines.push(`
    <tr class="all-changes-row${offlineCls}" data-order-id="${escapeHtml(oid)}">
      <td>${escapeHtml(formatTaskDateRu(row.created_at))}</td>
      <td>${escapeHtml(formatLoginFive(row.user_email))}</td>
      <td>${escapeHtml(chip)}</td>
      <td class="all-changes-text-cell">${escapeHtml(row.comment || "")}</td>
    </tr>`);
  }
  tbody.innerHTML = lines.join("");

  if (lines.length === 0 && msg) {
    msg.textContent = error
      ? "Нет сохранённой копии изменений на этом устройстве."
      : "Пока нет записей об изменениях.";
  }

  applyAllChangesFilter();
}

export function initAllChangesSection() {
  const btn = document.getElementById("allChangesSearchBtn");
  const input = document.getElementById("allChangesSearchInput");
  if (!btn || !input) return;
  btn.addEventListener("click", () => applyAllChangesFilter());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyAllChangesFilter();
    }
  });
}
