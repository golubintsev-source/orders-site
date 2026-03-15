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

export function renderOrders(orders) {
  const table = document.querySelector("#ordersTable tbody");
  table.innerHTML = "";

  orders.forEach((order) => {
    const editButton = `
      <button type="button" onclick="editOrder(${order.id})">
        Редактировать
      </button>
    `;

    const deleteButton =
      state.currentRole === "admin"
        ? `<button type="button" onclick="deleteOrder(${order.id})">Удалить</button>`
        : "";

    const filesCount = state.filesCountMap[order.id] || 0;

    const filesButton =
      filesCount > 0
        ? `
          <button
            type="button"
            class="files-badge-btn"
            onclick="openFilesModal(${order.id})"
          >
            📎 ${filesCount} файл${getFilesWord(filesCount)}
          </button>
        `
        : "";

    const phone = order.phone ?? "";
    const telHref = phone ? "tel:" + phone.replace(/[^\d+]/g, "") : "";
    const phoneCell = phone ? `<a href="${telHref}" class="tel-link">${phone}</a>` : "";

    const row = `
      <tr>
        <td>${phoneCell}</td>
        <td>${order.client ?? ""}</td>
        <td>${order.address ?? ""}</td>
        <td>
          <span class="${
            order.payment_status === "оплачен" ? "status-paid" : "status-no"
          }">
            ${order.payment_status ?? ""}
          </span>
        </td>
        <td>${order.order_date ?? ""}</td>
        <td>${order.order_number ?? ""}</td>
        <td>${order.description ?? ""}</td>
        <td>${order.amount ?? ""}</td>
        <td>${order.prepayment ?? ""}</td>
        <td>${order.remaining_amount ?? ""}</td>
        <td>${order.delivery_date ?? ""}</td>
        <td>${filesButton}</td>
        <td>
          ${editButton}
          ${deleteButton}
        </td>
      </tr>
    `;

    table.innerHTML += row;
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
    delivery: document.getElementById("delivery").value.trim() || null,
    delivery_date: document.getElementById("delivery_date").value || null,
  };
}

export function fillForm(order) {
  document.getElementById("phone").value = order.phone || "";
  document.getElementById("phone").dispatchEvent(new Event("input", { bubbles: true }));
  document.getElementById("client").value = order.client || "";
  document.getElementById("address").value = order.address || "";
  document.getElementById("payment_status").value = order.payment_status || "";
  const orderDateVal = order.order_date || "";
  document.getElementById("order_date").value = orderDateVal.includes("T") ? orderDateVal.slice(0, 16) : (orderDateVal ? orderDateVal + "T00:00" : "");
  document.getElementById("order_number").value = order.order_number || "";
  document.getElementById("description").value = order.description || "";
  document.getElementById("amount").value = order.amount ?? "";
  document.getElementById("prepayment").value = order.prepayment ?? "";
  document.getElementById("prepayment_to").value = order.prepayment_to || "";
  document.getElementById("remaining_amount").value = order.remaining_amount ?? "";
  document.getElementById("remaining_to").value = order.remaining_to || "";
  document.getElementById("area_m2").value = order.area_m2 ?? "";
  document.getElementById("delivery").value = order.delivery || "";
  document.getElementById("delivery_date").value = order.delivery_date || "";

  resetFileUpload();
}

function getNowForDateTimeLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function resetFormMode() {
  state.editingOrderId = null;
  document.getElementById("orderForm").reset();
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
    submitBtn.textContent = "Сохранить заявку";
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
    .delete()
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
  const phoneDigits = phoneVal.replace(/\D/g, "");
  const phoneValid = phoneVal === "" || (phoneDigits.length === 11 && (phoneDigits[0] === "8" || phoneDigits[0] === "7"));
  if (!phoneValid) {
    message.textContent = "Телефон";
    message.style.color = "#b00020";
    document.getElementById("phone")?.classList.add("phone-invalid");
    return;
  }

  message.style.color = "";
  message.textContent = "Сохраняю...";

  const orderData = getFormData();

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
    message.style.color = "#b00020";
    return;
  }

  await uploadFiles(savedOrderId);

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