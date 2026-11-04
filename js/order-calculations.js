import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import { formatAmount, formatOrderIdTypeChip, tryParseRublesInteger } from "./format.js";
import { buildOrderEditUrl } from "./app-routes.js";
import { getCalcDisplayAuthor, formatCalcDisplayComment, formatInstallationCalculationDisplayComment } from "./calculations-format.js";
import { defaultSalaryPaymentFrom, SALARY_PAYMENT_FROM_PLACES } from "./salary-payment.js";
import { shortLoginByEmail } from "./user-names.js";
import { canEditManualCalculations, canSelectKassaBeznal, KASSA_BEZNAL_PLACES } from "./roles.js";
import { getEditors } from "./settings.js";
import { bindAutogrowTextarea, resizeTextarea } from "./autogrow-textarea.js";

let activeOrder = null;
let bound = false;
let saving = false;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function setMessage(text, error = false) {
  const el = document.getElementById("orderCalcFormMessage");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = error ? "#d32f2f" : "#166534";
}

function formatTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  const months = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getDate()} ${months[date.getMonth()]} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function getIncomeExpense(row) {
  const amount = formatAmount(row?.amount);
  if (!amount) return { income: "", expense: "" };
  const isIncome = ["Вова", "Дима", "Касса", "Безнал"].includes(row?.to_place) &&
    !/^з\/п\s/iu.test(String(row?.comment || ""));
  return isIncome ? { income: amount, expense: "" } : { income: "", expense: amount };
}

function renderRecipientOptions() {
  const select = document.getElementById("orderCalcRecipient");
  const destination = document.getElementById("orderCalcTo")?.value || "Монтаж";
  if (!select) return;
  const needsRecipient = destination === "Монтаж" || destination === "Откосы";
  const previous = select.value;
  const names = needsRecipient ? getEditors() : [];
  select.innerHTML = names.length
    ? ['<option value="">—</option>', ...names.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)].join("")
    : '<option value="">—</option>';
  select.disabled = !needsRecipient;
  select.required = needsRecipient;
  if (needsRecipient && names.includes(previous)) select.value = previous;
  if (needsRecipient && !names.length) setMessage("В настройках не указаны монтажники", true);
  else setMessage("");
}

function renderRows(rows) {
  const tbody = document.querySelector("#orderCalculationsTable tbody");
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8">По этому заказу расчётов пока нет.</td></tr>';
    return;
  }
  const orderId = Number(activeOrder?.id);
  const orderLabel = formatOrderIdTypeChip(orderId, activeOrder?.order_type) || String(orderId);
  tbody.innerHTML = rows.map((row) => {
    const { income, expense } = getIncomeExpense(row);
    const addressMap = new Map([[orderId, String(activeOrder?.address || "").trim()]]);
    let comment = formatCalcDisplayComment(row.comment, addressMap);
    if (/^\[AUTO_ORDER_DELTA\]\s+Монтаж\s*;/u.test(String(row.comment || ""))) {
      comment = formatInstallationCalculationDisplayComment(comment, activeOrder?.installer_name);
    }
    return `<tr>
      <td><span class="status-value">${escapeHtml(formatTime(row.created_at))}</span></td>
      <td class="td-calc-order"><a href="${escapeHtml(buildOrderEditUrl(orderId))}">${escapeHtml(orderLabel)}</a></td>
      <td class="td-money">${income ? `<span class="status-value">${escapeHtml(income)}</span>` : ""}</td>
      <td class="td-money">${expense ? `<span class="status-value">${escapeHtml(expense)}</span>` : ""}</td>
      <td class="td-calc-comment">${escapeHtml(comment)}</td>
      <td>${escapeHtml(row.from_place)}</td><td>${escapeHtml(row.to_place)}</td>
      <td class="td-calc-author">${escapeHtml(getCalcDisplayAuthor(row.comment))}</td>
    </tr>`;
  }).join("");
}

export async function loadOrderCalculations() {
  if (!activeOrder?.id) return;
  const tbody = document.querySelector("#orderCalculationsTable tbody");
  if (tbody) tbody.innerHTML = '<tr><td colspan="8">Загрузка…</td></tr>';
  const { data, error } = await supabaseClient.from("calculations")
    .select("id, created_at, order_id, from_place, to_place, amount, comment, deleted_at")
    .eq("order_id", activeOrder.id).is("deleted_at", null)
    .order("created_at", { ascending: false }).order("id", { ascending: false });
  if (error) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="8">Не удалось загрузить расчёты заказа.</td></tr>';
    return;
  }
  renderRows(data || []);
}

function buildPayload() {
  const from = String(document.getElementById("orderCalcFrom")?.value || "").trim();
  const to = String(document.getElementById("orderCalcTo")?.value || "").trim();
  const selectedRecipient = String(document.getElementById("orderCalcRecipient")?.value || "").trim();
  const needsRecipient = to === "Монтаж" || to === "Откосы";
  const recipient = needsRecipient ? selectedRecipient : to;
  const comment = String(document.getElementById("orderCalcComment")?.value || "").trim();
  const parsed = tryParseRublesInteger(document.getElementById("orderCalcAmount")?.value || "");
  if (!SALARY_PAYMENT_FROM_PLACES.includes(from)) throw new Error("Выберите, откуда выплачивается сумма");
  if (!canSelectKassaBeznal() && KASSA_BEZNAL_PLACES.has(from)) throw new Error("Этот источник недоступен для вашей роли");
  if (!["Монтаж", "Откосы", "Комиссия", "Другое"].includes(to)) throw new Error("Выберите направление выплаты");
  if (needsRecipient && !recipient) throw new Error("Выберите монтажника");
  if (parsed.invalidFormat || !Number.isSafeInteger(parsed.value) || parsed.value <= 0) throw new Error("Укажите положительную сумму в целых рублях");
  const author = shortLoginByEmail(state.currentUser?.email || "");
  return {
    order_id: activeOrder.id, from_place: from, to_place: to, amount: parsed.value,
    comment: `з/п [${recipient}]${comment ? `, ${comment}` : ""}; ${author}`,
    created_at: new Date().toISOString(),
  };
}

async function submit() {
  if (saving || !activeOrder?.id) return;
  let payload;
  try { payload = buildPayload(); } catch (error) { setMessage(error.message, true); return; }
  saving = true;
  const button = document.getElementById("orderCalcSubmitBtn");
  if (button) button.disabled = true;
  setMessage("Сохранение…");
  const { error } = await supabaseClient.from("calculations").insert([payload]);
  saving = false;
  if (button) button.disabled = false;
  if (error) { setMessage("Не удалось добавить строку в расчёты", true); return; }
  document.getElementById("orderCalcAmount").value = "";
  const comment = document.getElementById("orderCalcComment");
  if (comment) {
    comment.value = "";
    resizeTextarea(comment);
  }
  setMessage("Строка добавлена в расчёты");
  await loadOrderCalculations();
}

export function initOrderCalculations() {
  if (bound) return;
  bound = true;
  document.getElementById("orderCalcSubmitBtn")?.addEventListener("click", () => { void submit(); });
  document.getElementById("orderCalcTo")?.addEventListener("change", renderRecipientOptions);
  bindAutogrowTextarea(document.getElementById("orderCalcComment"));
}

export async function showOrderCalculations(order) {
  activeOrder = order || null;
  const block = document.getElementById("orderCalculationsBlock");
  if (!block || !activeOrder?.id) return;
  block.hidden = false;
  const form = document.getElementById("orderCalculationForm");
  if (form) form.hidden = !canEditManualCalculations();
  const from = document.getElementById("orderCalcFrom");
  if (from) {
    for (const option of from.options) {
      option.disabled = !canSelectKassaBeznal() && KASSA_BEZNAL_PLACES.has(option.value);
    }
    from.value = defaultSalaryPaymentFrom();
  }
  const to = document.getElementById("orderCalcTo");
  if (to) to.value = "Монтаж";
  const amount = document.getElementById("orderCalcAmount");
  const comment = document.getElementById("orderCalcComment");
  if (amount) amount.value = "";
  if (comment) {
    comment.value = "";
    resizeTextarea(comment);
  }
  renderRecipientOptions();
  await loadOrderCalculations();
}

export function hideOrderCalculations() {
  activeOrder = null;
  const block = document.getElementById("orderCalculationsBlock");
  if (block) block.hidden = true;
  setMessage("");
}
