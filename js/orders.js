import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import {
  clientSearch,
  message,
  submitBtn,
  submitBtnTop,
  formTitle,
  cancelEditBtn,
  cancelEditBtnTop,
  sectionNavBtns,
  contentSections,
  sectionNewTab,
} from "./dom.js";
import {
  loadFilesCountMap,
  getFilesWord,
  uploadFiles,
  resetFileUpload,
} from "./files.js";
import { formatAmount } from "./format.js";

export async function loadOrders() {
  const { data, error } = await supabaseClient
    .from("orders")
    .select("*")
    .is("deleted_at", null)
    .order("id", { ascending: false });

  if (error) {
    console.error("Ошибка загрузки:", error);
    message.textContent = "Ошибка загрузки заявок";
    return;
  }

  state.allOrders = data || [];
  await loadFilesCountMap();
  applyFiltersAndRender();
}

const STATUS_OPTIONS = [
  "Контакт с клиентом",
  "Замер назначен",
  "Замер проведен",
  "Расчет сформирован",
  "Предложение направлено",
  "Клиент согласен",
  "Производство",
  "Монтаж выполнен",
  "Заказ закрыт",
];

function normalizeStatus(val) {
  if (val === "нет" || val === "оплачен" || val == null || val === "") return "Контакт с клиентом";
  return val;
}

function getFilteredOrders() {
  let list = state.allOrders;

  if (state.statusFilterSelected && state.statusFilterSelected.length > 0) {
    list = list.filter((order) => {
      const norm = normalizeStatus(order.payment_status);
      return state.statusFilterSelected.includes(norm);
    });
  }

  const query = clientSearch?.value.trim().toLowerCase() || "";
  if (query) {
    list = list.filter((order) => {
      const phone = (order.phone || "").toLowerCase();
      const name = (order.client || "").toLowerCase();
      const address = (order.address || "").toLowerCase();
      const number = (order.order_number || "").toLowerCase();
      const description = (order.description || "").toLowerCase();
      return phone.includes(query) || name.includes(query) || address.includes(query) || number.includes(query) || description.includes(query);
    });
  }

  return list;
}

function applyFiltersAndRender() {
  renderOrders(getFilteredOrders());
}

function escapeHtml(s) {
  if (s == null || s === "") return "";
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function escapeAttr(s) {
  if (s == null || s === "") return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function formatDateDDMMYYYY(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return "";
  const s = dateStr.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return dateStr;
  const [, y, m, d] = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  return `${d}.${m}.${y}`;
}

/** Оплачено в таблице только по полю "Кому остаток", без проверки суммы. */
function isOrderPaid(order) {
  const raw = (order.remaining_to || "").trim();
  return raw !== "" && raw !== "—";
}

function paidBadge(order) {
  if (order.amount == null || order.amount === "") return "";
  const paid = isOrderPaid(order);
  const status = order.payment_status || "";
  if (paid) return '<span class="status-paid">да</span>';
  if (status === "Производство" || status === "Монтаж выполнен") return '<span class="paid-no-alert">нет</span>';
  return '<span class="status-value">нет</span>';
}

export function renderOrders(orders) {
  const table = document.querySelector("#ordersTable tbody");
  table.innerHTML = "";

  orders.forEach((order) => {
    const editIcon = `<button type="button" class="btn-icon btn-edit" onclick="editOrder(${order.id})" title="Редактировать"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;

    const historyIcon = `<a href="history.html?order_id=${order.id}" class="btn-icon btn-history" title="История"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></a>`;

    const deleteButton =
      state.currentRole === "admin"
        ? `<button type="button" class="btn-icon btn-delete" onclick="deleteOrder(${order.id})" title="Удалить"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>`
        : "";

    const filesCount = state.filesCountMap[order.id] || 0;

    const filesIcon = filesCount > 0
      ? `<button type="button" class="btn-icon btn-files" onclick="openFilesModal(${order.id})" title="Файлы: ${filesCount}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg><span class="btn-files-count">${filesCount}</span></button>`
      : "";

    const phone = order.phone ?? "";
    const telHref = phone ? "tel:" + phone.replace(/[^\d+]/g, "") : "";
    const client = order.client ?? "";
    const address = order.address ?? "";
    const description = order.description ?? "";
    const clientCell = client ? escapeHtml(client) : "";
    const phoneCallIcon = phone
      ? `<a href="${escapeAttr(telHref)}" class="btn-icon btn-phone-call" title="Позвонить"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg></a>`
      : "";
    const row = `
      <tr>
        <td class="td-phone-call">${phoneCallIcon}</td>
        <td class="td-actions">${editIcon}${filesIcon}</td>
        <td class="td-order-id"><span class="status-value">${order.id != null ? String(order.id).padStart(4, "0") : ""}</span></td>
        <td class="td-truncate-name" data-fulltext="${escapeAttr(client)}">${clientCell}</td>
        <td class="td-truncate-address" data-fulltext="${escapeAttr(address)}">${escapeHtml(address)}</td>
        <td class="td-truncate-description" data-fulltext="${escapeAttr(description)}">${escapeHtml(description)}</td>
        <td>
          <span class="status-value">
            ${order.payment_status === "нет" ? "Контакт с клиентом" : (order.payment_status ?? "Контакт с клиентом")}
          </span>
        </td>
        <td class="td-order-date">${formatDateDDMMYYYY(order.order_date)}</td>
        <td class="td-order-number">${order.order_number ?? ""}</td>
        <td class="td-paid">${paidBadge(order)}</td>
        <td>${order.amount != null && order.amount !== "" ? `<span class="status-value">${formatAmount(order.amount)}</span>` : ""}</td>
        <td class="td-prepayment">${formatAmount(order.prepayment) + (order.prepayment_to ? " | " + escapeHtml(order.prepayment_to) : "")}</td>
        <td class="td-remaining">${formatAmount(order.remaining_amount) + (order.remaining_to ? " | " + escapeHtml(order.remaining_to) : "")}</td>
        <td class="td-delivery">${order.delivery ? escapeHtml(order.delivery) : ""}</td>
        <td>${formatDateDDMMYYYY(order.delivery_date)}</td>
        <td>${formatDateDDMMYYYY(order.installation_date)}</td>
        <td>${order.installer_payment_by && order.installer_payment_amount != null && order.installer_payment_amount !== "" ? `<span class="installer-paid-value">${formatAmount(order.installer_payment_amount)}</span>` : (order.installer_payment_amount != null && order.installer_payment_amount !== "" ? formatAmount(order.installer_payment_amount) : "")}</td>
        <td>${order.installer_payment_by ? escapeHtml(order.installer_payment_by) : ""}</td>
        <td>${formatDateDDMMYYYY(order.reveals_date)}</td>
        <td class="td-phone">${phone ? escapeHtml(phone) : ""}</td>
        <td class="td-actions td-delete">${historyIcon}${deleteButton}</td>
      </tr>
    `;

    table.innerHTML += row;
  });

  table.querySelectorAll(".td-truncate-name, .td-truncate-address, .td-truncate-description").forEach((cell) => {
    const full = cell.getAttribute("data-fulltext");
    if (full && cell.scrollWidth > cell.clientWidth) {
      cell.setAttribute("title", full);
    }
  });
}

export function applyClientFilter() {
  applyFiltersAndRender();
}

function renderStatusFilterDropdown() {
  const container = document.getElementById("statusFilterCheckboxes");
  if (!container) return;
  const allSelected = !state.statusFilterSelected || state.statusFilterSelected.length === 0;
  const allHtml = `<label class="status-filter-item status-filter-all"><input type="checkbox" data-all="true" ${allSelected ? "checked" : ""}> Все</label>`;
  const optionsHtml = STATUS_OPTIONS.map((value) => {
    const checked = allSelected || state.statusFilterSelected.includes(value);
    return `<label class="status-filter-item"><input type="checkbox" data-status="${escapeAttr(value)}" ${checked ? "checked" : ""}> ${escapeHtml(value)}</label>`;
  }).join("");
  container.innerHTML = allHtml + optionsHtml;
  container.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", onStatusFilterChange);
  });
}

function onStatusFilterChange(e) {
  const container = document.getElementById("statusFilterCheckboxes");
  if (!container) return;
  const target = e.target;
  const allCb = container.querySelector('input[data-all="true"]');
  const statusCbs = container.querySelectorAll('input[type=checkbox][data-status]');

  if (target === allCb) {
    const checked = allCb.checked;
    statusCbs.forEach((cb) => { cb.checked = checked; });
    state.statusFilterSelected = checked ? [] : [];
    applyFiltersAndRender();
    return;
  }

  const checkedValues = Array.from(statusCbs).filter((cb) => cb.checked).map((el) => el.dataset.status);
  state.statusFilterSelected = checkedValues.length === STATUS_OPTIONS.length ? [] : checkedValues;
  if (allCb) allCb.checked = checkedValues.length === STATUS_OPTIONS.length;
  applyFiltersAndRender();
}

export function initStatusFilter() {
  const btn = document.getElementById("statusFilterBtn");
  const dropdown = document.getElementById("statusFilterDropdown");
  if (!btn || !dropdown) return;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = dropdown.style.display === "block";
    if (isOpen) {
      dropdown.style.display = "none";
      btn.setAttribute("aria-expanded", "false");
    } else {
      renderStatusFilterDropdown();
      const rect = btn.getBoundingClientRect();
      dropdown.style.position = "fixed";
      dropdown.style.top = rect.bottom + 4 + "px";
      dropdown.style.left = rect.left + "px";
      dropdown.style.display = "block";
      btn.setAttribute("aria-expanded", "true");
    }
  });

  document.addEventListener("click", () => {
    if (dropdown.style.display === "block") {
      dropdown.style.display = "none";
      btn.setAttribute("aria-expanded", "false");
    }
  });

  dropdown.addEventListener("click", (e) => e.stopPropagation());
}

export function getFormData() {
  return {
    phone: document.getElementById("phone").value.trim() || null,
    client: document.getElementById("client").value.trim() || null,
    client_type: document.getElementById("client_type_dealer")?.checked ? "Диллер" : "Частник",
    address: document.getElementById("address").value.trim() || null,
    payment_status: document.getElementById("payment_status").value.trim() || null,
    order_date: document.getElementById("order_date").value || null,
    order_number: document.getElementById("order_number").value.trim() || null,
    description: document.getElementById("description").value.trim() || null,
    amount: document.getElementById("amount").value
      ? Number(document.getElementById("amount").value)
      : null,
    prepayment: document.getElementById("prepayment").value
      ? Number(document.getElementById("prepayment").value)
      : null,
    prepayment_to: document.getElementById("prepayment_to").value.trim() || null,
    remaining_amount: document.getElementById("remaining_amount").value
      ? Number(document.getElementById("remaining_amount").value)
      : null,
    remaining_to: document.getElementById("remaining_to").value.trim() || null,
    area_m2: document.getElementById("area_m2").value
      ? Number(document.getElementById("area_m2").value)
      : null,
    mosquito_nets: document.getElementById("mosquito_nets").value
      ? Number(document.getElementById("mosquito_nets").value)
      : null,
    construction_count: document.getElementById("construction_count").value
      ? Number(document.getElementById("construction_count").value)
      : null,
    delivery: document.getElementById("delivery").value.trim() || null,
    delivery_date: document.getElementById("delivery_date").value || null,
    installation: document.getElementById("installation").checked,
    installation_date: document.getElementById("installation").checked
      ? (document.getElementById("installation_date").value || null)
      : null,
    reveals: document.getElementById("reveals").checked,
    reveals_date: document.getElementById("reveals").checked
      ? (document.getElementById("reveals_date").value || null)
      : null,
    installer_payment_amount: document.getElementById("installer_payment_amount")?.value
      ? Number(document.getElementById("installer_payment_amount").value)
      : null,
    installer_payment_by: document.getElementById("installer_payment_by")?.value?.trim() || null,
  };
}

/** Автозаполнение Остаток = Стоимость - Предоплата, если Стоимость заполнена */
export function updateRemainingFromCostAndPrepayment() {
  const amountEl = document.getElementById("amount");
  const prepaymentEl = document.getElementById("prepayment");
  const remainingEl = document.getElementById("remaining_amount");
  if (!amountEl || !prepaymentEl || !remainingEl) return;
  const amountVal = (amountEl.value || "").trim();
  if (amountVal === "") return;
  const amount = parseFloat(amountVal);
  if (Number.isNaN(amount)) return;
  const prepayment = parseFloat(prepaymentEl.value) || 0;
  const remaining = amount - prepayment;
  remainingEl.value = remaining === 0 ? "0" : String(remaining);
}

/** Оплачено = "да" только если заполнено "Кому остаток" (select). Правило по сумме не используется. */
export function updatePaidField() {
  const remainingToEl = document.getElementById("remaining_to");
  const paidEl = document.getElementById("paid");
  if (!paidEl || !remainingToEl || remainingToEl.tagName !== "SELECT") return;
  const raw = (remainingToEl.value || "").trim();
  const remainingToFilled = raw !== "" && raw !== "—";
  paidEl.value = remainingToFilled ? "да" : "нет";
}

export function updateConditionalRequiredHighlight() {
  const prepaymentVal = (document.getElementById("prepayment")?.value || "").trim();
  const prepaymentToVal = (document.getElementById("prepayment_to")?.value || "").trim();
  const deliveryVal = (document.getElementById("delivery")?.value || "").trim();
  const deliveryDateVal = (document.getElementById("delivery_date")?.value || "").trim();
  const prepaymentToEl = document.getElementById("prepayment_to");
  const deliveryDateEl = document.getElementById("delivery_date");
  if (prepaymentToEl) prepaymentToEl.classList.toggle("conditional-invalid", !!prepaymentVal && !prepaymentToVal);
  if (deliveryDateEl) deliveryDateEl.classList.toggle("conditional-invalid", !!deliveryVal && !deliveryDateVal);
}

function getInstallerPaymentElements() {
  return {
    block: document.getElementById("installer_payment_block"),
    amountEl: document.getElementById("installer_payment_amount"),
    byEl: document.getElementById("installer_payment_by"),
    rateEl: document.getElementById("installer_rate_per_m2"),
    calcBtn: document.getElementById("installer_calc_btn"),
  };
}

export function setInstallerPaymentBlockDisabled(disabled) {
  const { amountEl, byEl } = getInstallerPaymentElements();
  if (amountEl) amountEl.disabled = disabled;
  if (byEl) byEl.disabled = disabled;
}

const INSTALLER_BLOCK_INACTIVE_CLASS = "installer-block-inactive";

/** Блок оплаты монтажа неактивен (серый, disabled), пока не заполнена дата монтажа. */
export function updateInstallerBlockByInstallationDate() {
  const installationDateInput = document.getElementById("installation_date");
  const hasDate = !!(installationDateInput && installationDateInput.value && installationDateInput.value.trim());
  const { block, amountEl, byEl, rateEl, calcBtn } = getInstallerPaymentElements();
  if (!block) return;
  block.classList.toggle(INSTALLER_BLOCK_INACTIVE_CLASS, !hasDate);
  if (rateEl) rateEl.disabled = !hasDate;
  if (calcBtn) calcBtn.disabled = !hasDate;
  const amountDisabled = !hasDate || state.installerPaymentDone;
  if (amountEl) amountEl.disabled = amountDisabled;
  const hasAmount = !!(amountEl && String(amountEl.value || "").trim());
  const byDisabled = !hasDate || state.installerPaymentDone || !hasAmount;
  if (byEl) byEl.disabled = byDisabled;
}

/** По умолчанию Сумма (монтаж) = Площадь м² × Монтаж 1м²; вызывается при изменении площади/ставки и при открытии/сбросе формы. */
export function updateInstallerPaymentAmountFromArea() {
  const { amountEl } = getInstallerPaymentElements();
  if (!amountEl || amountEl.disabled) return;
  const areaEl = document.getElementById("area_m2");
  const rateEl = document.getElementById("installer_rate_per_m2");
  const area = parseFloat(areaEl?.value) || 0;
  const rate = parseFloat(rateEl?.value) || (state.defaultInstallerRatePerM2 ?? 1400);
  amountEl.value = area > 0 && rate > 0 ? String(area * rate) : "";
  updateInstallerBlockByInstallationDate();
}

/** При открытии заказа проверить, есть ли уже запись об оплате монтажнику; если да — заполнить и отключить блок. */
export async function checkInstallerPaymentDone(orderId) {
  if (orderId == null) return;
  const { data } = await supabaseClient
    .from("calculations")
    .select("from_place, amount")
    .ilike("comment", `%монтажнику за заказ -${orderId}-%`)
    .limit(1);
  const row = data?.[0];
  if (!row) return;
  state.installerPaymentDone = true;
  const { amountEl, byEl } = getInstallerPaymentElements();
  if (amountEl) amountEl.value = row.amount != null ? String(row.amount) : "";
  if (byEl) byEl.value = row.from_place || "";
  updateInstallerBlockByInstallationDate();
}

export function fillForm(order) {
  state.installerPaymentDone = false;
  document.getElementById("phone").value = order.phone || "";
  document.getElementById("phone").dispatchEvent(new Event("input", { bubbles: true }));
  document.getElementById("client").value = order.client || "";
  const clientTypeDealerCb = document.getElementById("client_type_dealer");
  if (clientTypeDealerCb) clientTypeDealerCb.checked = order.client_type === "Диллер";
  document.getElementById("address").value = order.address || "";
  const statusVal = order.payment_status || "";
  const displayStatus = statusVal === "нет" || statusVal === "оплачен" || !statusVal
    ? ""
    : statusVal;
  const paymentStatusEl = document.getElementById("payment_status");
  if (paymentStatusEl) {
    paymentStatusEl.value = displayStatus;
    if (paymentStatusEl.value !== displayStatus) paymentStatusEl.value = ""; /* fallback if option missing */
  }
  state.initialPaymentStatus = displayStatus;
  const orderDateVal = order.order_date || "";
  document.getElementById("order_date").value = orderDateVal.includes("T") ? orderDateVal.slice(0, 16) : (orderDateVal ? orderDateVal + "T00:00" : "");
  document.getElementById("order_number").value = order.order_number || "";
  document.getElementById("description").value = order.description ?? "";
  document.getElementById("amount").value = order.amount ?? "";
  document.getElementById("prepayment").value = order.prepayment ?? "";
  document.getElementById("prepayment_to").value = order.prepayment_to || "";
  document.getElementById("remaining_amount").value = order.remaining_amount ?? "";
  document.getElementById("remaining_to").value = order.remaining_to || "";
  document.getElementById("area_m2").value = order.area_m2 ?? "";
  const installerAmountEl = document.getElementById("installer_payment_amount");
  if (installerAmountEl) installerAmountEl.value = order.installer_payment_amount != null ? String(order.installer_payment_amount) : "";
  const installerByEl = document.getElementById("installer_payment_by");
  if (installerByEl) installerByEl.value = order.installer_payment_by || "";
  document.getElementById("mosquito_nets").value = order.mosquito_nets ?? "";
  document.getElementById("construction_count").value = order.construction_count ?? "";
  document.getElementById("delivery").value = order.delivery || "";
  document.getElementById("delivery_date").value = order.delivery_date || "";
  const installationCb = document.getElementById("installation");
  const installationDateWrap = document.getElementById("installationDateWrap");
  const installationDateInput = document.getElementById("installation_date");
  if (installationCb) installationCb.checked = !!order.installation;
  if (installationDateWrap) installationDateWrap.style.display = order.installation ? "" : "none";
  if (installationDateInput) installationDateInput.value = order.installation_date || "";
  updateInstallerBlockByInstallationDate();
  const revealsCb = document.getElementById("reveals");
  const revealsDateWrap = document.getElementById("revealsDateWrap");
  const revealsDateInput = document.getElementById("reveals_date");
  if (revealsCb) revealsCb.checked = !!order.reveals;
  if (revealsDateWrap) revealsDateWrap.style.display = order.reveals ? "" : "none";
  if (revealsDateInput) revealsDateInput.value = order.reveals_date || "";

  updatePaidField();
  updateConditionalRequiredHighlight();
  resetFileUpload();
  checkInstallerPaymentDone(order.id);
}

function getNowForDateTimeLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function resetFormMode() {
  state.editingOrderId = null;
  state.editingOrderDescription = null;
  state.initialPaymentStatus = null;
  state.installerPaymentDone = false;
  document.getElementById("orderForm").reset();
  updatePaidField();
  updateConditionalRequiredHighlight();
  const inst = getInstallerPaymentElements();
  if (inst.amountEl) inst.amountEl.value = "";
  if (inst.byEl) inst.byEl.value = "";
  setInstallerPaymentBlockDisabled(false);
  const ratePerM2El = document.getElementById("installer_rate_per_m2");
  if (ratePerM2El) ratePerM2El.value = String(state.defaultInstallerRatePerM2 ?? 1400);
  const orderDateInput = document.getElementById("order_date");
  if (orderDateInput) orderDateInput.value = getNowForDateTimeLocal();
  const clientTypeDealerCb = document.getElementById("client_type_dealer");
  if (clientTypeDealerCb) clientTypeDealerCb.checked = false;
  const installationCb = document.getElementById("installation");
  const installationDateWrap = document.getElementById("installationDateWrap");
  const installationDateInput = document.getElementById("installation_date");
  if (installationCb) installationCb.checked = false;
  if (installationDateWrap) installationDateWrap.style.display = "none";
  if (installationDateInput) installationDateInput.value = "";
  updateInstallerBlockByInstallationDate();
  const revealsCb = document.getElementById("reveals");
  const revealsDateWrap = document.getElementById("revealsDateWrap");
  const revealsDateInput = document.getElementById("reveals_date");
  if (revealsCb) revealsCb.checked = false;
  if (revealsDateWrap) revealsDateWrap.style.display = "none";
  if (revealsDateInput) revealsDateInput.value = "";
  const phoneEl = document.getElementById("phone");
  if (phoneEl) phoneEl.dispatchEvent(new Event("input", { bubbles: true }));
  resetFileUpload();

  message.textContent = "Режим: новая заявка";

  if (sectionNewTab) {
    sectionNewTab.textContent = "Новый";
  }
  if (submitBtn) submitBtn.textContent = "Сохранить заказ";
  if (submitBtnTop) submitBtnTop.textContent = "Сохранить заказ";

  if (formTitle) {
    formTitle.textContent = "Новая заявка";
  }

  if (cancelEditBtn) cancelEditBtn.style.display = "inline-block";
  if (cancelEditBtnTop) cancelEditBtnTop.style.display = "inline-block";
}

export async function editOrder(orderId) {
  const { data, error } = await supabaseClient
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (error) {
    console.error("Ошибка загрузки заявки:", error);
    message.textContent = "Ошибка загрузки заявки";
    return;
  }

  state.editingOrderId = orderId;
  state.editingOrderDescription = data.description || null;
  fillForm(data);
  message.textContent = `Режим: редактирование заявки #${orderId}`;

  if (submitBtn) submitBtn.textContent = "Сохранить изменения";
  if (submitBtnTop) submitBtnTop.textContent = "Сохранить изменения";

  if (formTitle) {
    formTitle.textContent = `Редактирование заявки #${orderId}`;
  }

  if (cancelEditBtn) cancelEditBtn.style.display = "inline-block";
  if (cancelEditBtnTop) cancelEditBtnTop.style.display = "inline-block";

  if (sectionNewTab) {
    sectionNewTab.textContent = "Редактирование";
  }
  sectionNavBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.section === "new");
  });
  contentSections.forEach((section) => {
    section.classList.toggle("active", section.id === "section-new");
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

export async function deleteOrder(orderId) {
  if (state.currentRole !== "admin") return;

  const ok = confirm(`Удалить заявку #${orderId}?`);
  if (!ok) return;

  const { error } = await supabaseClient
    .from("orders")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", orderId);

  if (error) {
    console.error("Ошибка удаления:", error);
    message.textContent = "Ошибка при удалении";
    return;
  }

  message.textContent = `Заявка #${orderId} удалена`;
  await loadOrders();
}

export async function submitOrderForm(event) {
  event.preventDefault();

  const phoneVal = (document.getElementById("phone")?.value || "").trim();
  const clientVal = (document.getElementById("client")?.value || "").trim();

  if (!clientVal) {
    message.textContent = "Не заполнено Клиент";
    message.style.color = "#d32f2f";
    document.getElementById("client")?.classList.add("client-invalid");
    return;
  }
  document.getElementById("client")?.classList.remove("client-invalid");

  const statusVal = (document.getElementById("payment_status")?.value || "").trim();
  if (!statusVal) {
    message.textContent = "Не заполнено Статус";
    message.style.color = "#d32f2f";
    document.getElementById("payment_status")?.classList.add("payment-status-invalid");
    return;
  }
  document.getElementById("payment_status")?.classList.remove("payment-status-invalid");

  if (phoneVal) {
    const phoneDigits = phoneVal.replace(/\D/g, "");
    const phoneValid = phoneDigits.length === 11 && (phoneDigits[0] === "8" || phoneDigits[0] === "7");
    if (!phoneValid) {
      message.textContent = "Неверный формат телефона.";
      message.style.color = "#d32f2f";
      document.getElementById("phone")?.classList.add("phone-invalid");
      return;
    }
  }

  const prepaymentVal = (document.getElementById("prepayment")?.value || "").trim();
  const prepaymentToVal = (document.getElementById("prepayment_to")?.value || "").trim();
  const conditionalMissing = [];
  if (prepaymentVal && !prepaymentToVal) conditionalMissing.push("Кому предоплата");
  const deliveryVal = (document.getElementById("delivery")?.value || "").trim();
  const deliveryDateVal = (document.getElementById("delivery_date")?.value || "").trim();
  if (deliveryVal && !deliveryDateVal) conditionalMissing.push("Дата");
  if (conditionalMissing.length > 0) {
    message.textContent = "Заполните поля: " + conditionalMissing.join(", ");
    message.style.color = "#d32f2f";
    updateConditionalRequiredHighlight();
    return;
  }

  message.style.color = "";
  message.textContent = "Сохраняю...";

  const orderData = getFormData();
  if (state.editingOrderId) {
    orderData.description = state.editingOrderDescription ?? null;
  }

  let error = null;
  let savedOrderId = state.editingOrderId;
  const wasEditing = Boolean(state.editingOrderId);

  if (state.editingOrderId) {
    const result = await supabaseClient
      .from("orders")
      .update(orderData)
      .eq("id", state.editingOrderId)
      .select()
      .single();

    error = result.error;

    if (!error && result.data) {
      savedOrderId = result.data.id;
    }
  } else {
    const result = await supabaseClient
      .from("orders")
      .insert([orderData])
      .select()
      .single();

    error = result.error;

    if (!error && result.data) {
      savedOrderId = result.data.id;
    }
  }

  if (error) {
    console.error("Ошибка сохранения:", error);
    const detail = error.message || error.hint || String(error.code);
    message.textContent = (wasEditing ? "Ошибка при обновлении заявки. " : "Ошибка при сохранении заявки. ") + detail;
    message.style.color = "#d32f2f";
    return;
  }

  await uploadFiles(savedOrderId);

  const addCommentText = (document.getElementById("description")?.value || "").trim();
  const newStatus = orderData.payment_status || "";

  if (!wasEditing && savedOrderId && state.currentUser?.email) {
    const historyRows = [
      { order_id: savedOrderId, user_email: state.currentUser.email, comment: "Заказ создан" },
      { order_id: savedOrderId, user_email: state.currentUser.email, comment: `Статус: ${newStatus || "Контакт с клиентом"}` },
    ];
    if (addCommentText) {
      historyRows.push({ order_id: savedOrderId, user_email: state.currentUser.email, comment: addCommentText });
    }
    await supabaseClient.from("order_history").insert(historyRows);
  }

  if (wasEditing && savedOrderId && state.currentUser?.email) {
    const historyRows = [];
    const oldStatus = state.initialPaymentStatus ?? "";
    if (oldStatus !== newStatus) {
      historyRows.push({
        order_id: savedOrderId,
        user_email: state.currentUser.email,
        comment: `Статус изменён: ${oldStatus || "—"} → ${newStatus || "—"}`,
      });
    }
    if (addCommentText) {
      historyRows.push({ order_id: savedOrderId, user_email: state.currentUser.email, comment: addCommentText });
    }
    if (historyRows.length > 0) {
      await supabaseClient.from("order_history").insert(historyRows);
    }
  }

  resetFormMode();
  await loadOrders();

  sectionNavBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.section === "all");
  });
  contentSections.forEach((section) => {
    section.classList.toggle("active", section.id === "section-all");
  });

  message.style.color = "";
  message.textContent = wasEditing
    ? `Заявка #${savedOrderId} обновлена`
    : `Заявка #${savedOrderId} сохранена`;
}