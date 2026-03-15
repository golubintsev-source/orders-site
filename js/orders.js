import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import {
  clientSearch,
  message,
  submitBtn,
  formTitle,
  cancelEditBtn,
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
  applyClientFilter();
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

function isOrderPaid(order) {
  const a = parseFloat(order.amount) || 0;
  const p = parseFloat(order.prepayment) || 0;
  const r = parseFloat(order.remaining_amount) || 0;
  return Math.abs(a - (p + r)) < 0.01 && a > 0;
}

function paidBadge(order) {
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
    const clientCell = client ? escapeHtml(client) : "";
    const phoneCallIcon = phone
      ? `<a href="${escapeAttr(telHref)}" class="btn-icon btn-phone-call" title="Позвонить"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg></a>`
      : "";
    const row = `
      <tr>
        <td class="td-phone-call">${phoneCallIcon}</td>
        <td class="td-actions">${editIcon}${historyIcon}${filesIcon}</td>
        <td class="td-truncate-name" data-fulltext="${escapeAttr(client)}">${clientCell}</td>
        <td class="td-truncate-address" data-fulltext="${escapeAttr(address)}">${escapeHtml(address)}</td>
        <td>
          <span class="status-value">
            ${order.payment_status === "нет" ? "Контакт с клиентом" : (order.payment_status ?? "Контакт с клиентом")}
          </span>
        </td>
        <td class="td-paid">${paidBadge(order)}</td>
        <td class="td-order-date">${order.order_date ?? ""}</td>
        <td class="td-order-number">${order.order_number ?? ""}</td>
        <td>${order.amount ?? ""}</td>
        <td>${order.prepayment ?? ""}</td>
        <td>${order.remaining_amount ?? ""}</td>
        <td class="td-delivery">${order.delivery ? escapeHtml(order.delivery) : ""}</td>
        <td>${order.delivery_date ?? ""}</td>
        <td class="td-phone">${phone ? escapeHtml(phone) : ""}</td>
        <td class="td-actions td-delete">${deleteButton}</td>
      </tr>
    `;

    table.innerHTML += row;
  });

  table.querySelectorAll(".td-truncate-name, .td-truncate-address").forEach((cell) => {
    const full = cell.getAttribute("data-fulltext");
    if (full && cell.scrollWidth > cell.clientWidth) {
      cell.setAttribute("title", full);
    }
  });
}

export function applyClientFilter() {
  const query = clientSearch?.value.trim().toLowerCase() || "";

  if (!query) {
    renderOrders(state.allOrders);
    return;
  }

  const filteredOrders = state.allOrders.filter((order) => {
    const phone = (order.phone || "").toLowerCase();
    const name = (order.client || "").toLowerCase();
    const address = (order.address || "").toLowerCase();
    const number = (order.order_number || "").toLowerCase();
    const description = (order.description || "").toLowerCase();
    return phone.includes(query) || name.includes(query) || address.includes(query) || number.includes(query) || description.includes(query);
  });

  renderOrders(filteredOrders);
}

export function getFormData() {
  return {
    phone: document.getElementById("phone").value.trim() || null,
    client: document.getElementById("client").value.trim() || null,
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
  };
}

export function updatePaidField() {
  const amountEl = document.getElementById("amount");
  const prepaymentEl = document.getElementById("prepayment");
  const remainingEl = document.getElementById("remaining_amount");
  const paidEl = document.getElementById("paid");
  if (!amountEl || !prepaymentEl || !remainingEl || !paidEl) return;
  const amount = parseFloat(amountEl.value) || 0;
  const prepayment = parseFloat(prepaymentEl.value) || 0;
  const remaining = parseFloat(remainingEl.value) || 0;
  const sum = prepayment + remaining;
  const isPaid = Math.abs(amount - sum) < 0.01 && amount > 0;
  paidEl.value = isPaid ? "да" : "нет";
}

export function updateConditionalRequiredHighlight() {
  const prepaymentVal = (document.getElementById("prepayment")?.value || "").trim();
  const prepaymentToVal = (document.getElementById("prepayment_to")?.value || "").trim();
  const remainingVal = (document.getElementById("remaining_amount")?.value || "").trim();
  const remainingToVal = (document.getElementById("remaining_to")?.value || "").trim();
  const deliveryVal = (document.getElementById("delivery")?.value || "").trim();
  const deliveryDateVal = (document.getElementById("delivery_date")?.value || "").trim();
  const prepaymentToEl = document.getElementById("prepayment_to");
  const remainingToEl = document.getElementById("remaining_to");
  const deliveryDateEl = document.getElementById("delivery_date");
  if (prepaymentToEl) prepaymentToEl.classList.toggle("conditional-invalid", !!prepaymentVal && !prepaymentToVal);
  if (remainingToEl) remainingToEl.classList.toggle("conditional-invalid", !!remainingVal && !remainingToVal);
  if (deliveryDateEl) deliveryDateEl.classList.toggle("conditional-invalid", !!deliveryVal && !deliveryDateVal);
}

export function fillForm(order) {
  document.getElementById("phone").value = order.phone || "";
  document.getElementById("phone").dispatchEvent(new Event("input", { bubbles: true }));
  document.getElementById("client").value = order.client || "";
  document.getElementById("address").value = order.address || "";
  const statusVal = order.payment_status || "";
  document.getElementById("payment_status").value =
    statusVal === "нет" || statusVal === "оплачен" || !statusVal
      ? "Контакт с клиентом"
      : statusVal;
  const orderDateVal = order.order_date || "";
  document.getElementById("order_date").value = orderDateVal.includes("T") ? orderDateVal.slice(0, 16) : (orderDateVal ? orderDateVal + "T00:00" : "");
  document.getElementById("order_number").value = order.order_number || "";
  document.getElementById("description").value = "";
  document.getElementById("amount").value = order.amount ?? "";
  document.getElementById("prepayment").value = order.prepayment ?? "";
  document.getElementById("prepayment_to").value = order.prepayment_to || "";
  document.getElementById("remaining_amount").value = order.remaining_amount ?? "";
  document.getElementById("remaining_to").value = order.remaining_to || "";
  document.getElementById("area_m2").value = order.area_m2 ?? "";
  document.getElementById("mosquito_nets").value = order.mosquito_nets ?? "";
  document.getElementById("construction_count").value = order.construction_count ?? "";
  document.getElementById("delivery").value = order.delivery || "";
  document.getElementById("delivery_date").value = order.delivery_date || "";

  updatePaidField();
  updateConditionalRequiredHighlight();
  resetFileUpload();
}

function getNowForDateTimeLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function resetFormMode() {
  state.editingOrderId = null;
  state.editingOrderDescription = null;
  document.getElementById("orderForm").reset();
  updatePaidField();
  updateConditionalRequiredHighlight();
  const orderDateInput = document.getElementById("order_date");
  if (orderDateInput) orderDateInput.value = getNowForDateTimeLocal();
  const phoneEl = document.getElementById("phone");
  if (phoneEl) phoneEl.dispatchEvent(new Event("input", { bubbles: true }));
  resetFileUpload();

  message.textContent = "Режим: новая заявка";

  if (sectionNewTab) {
    sectionNewTab.textContent = "Новый";
  }
  if (submitBtn) {
    submitBtn.textContent = "Сохранить заказ";
  }

  if (formTitle) {
    formTitle.textContent = "Новая заявка";
  }

  if (cancelEditBtn) {
    cancelEditBtn.style.display = "none";
  }
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

  if (submitBtn) {
    submitBtn.textContent = "Сохранить изменения";
  }

  if (formTitle) {
    formTitle.textContent = `Редактирование заявки #${orderId}`;
  }

  if (cancelEditBtn) {
    cancelEditBtn.style.display = "inline-block";
  }

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
  const remainingVal = (document.getElementById("remaining_amount")?.value || "").trim();
  const remainingToVal = (document.getElementById("remaining_to")?.value || "").trim();
  const conditionalMissing = [];
  if (prepaymentVal && !prepaymentToVal) conditionalMissing.push("Кому предоплата");
  if (remainingVal && !remainingToVal) conditionalMissing.push("Кому остаток");
  const deliveryVal = (document.getElementById("delivery")?.value || "").trim();
  const deliveryDateVal = (document.getElementById("delivery_date")?.value || "").trim();
  if (deliveryVal && !deliveryDateVal) conditionalMissing.push("Дата доставки");
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

  if (!wasEditing && savedOrderId && state.currentUser?.email) {
    const historyRows = [
      { order_id: savedOrderId, user_email: state.currentUser.email, comment: "Заказ создан" },
    ];
    if (addCommentText) {
      historyRows.push({ order_id: savedOrderId, user_email: state.currentUser.email, comment: addCommentText });
    }
    await supabaseClient.from("order_history").insert(historyRows);
  }

  if (wasEditing && savedOrderId && addCommentText && state.currentUser?.email) {
    await supabaseClient.from("order_history").insert([
      { order_id: savedOrderId, user_email: state.currentUser.email, comment: addCommentText },
    ]);
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