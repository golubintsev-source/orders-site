import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import {
  clientSearch,
  message,
  submitBtn,
  formTitle,
  cancelEditBtn,
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

    const row = `
      <tr>
        <td>${order.id ?? ""}</td>
        <td>${order.order_date ?? ""}</td>
        <td>${order.order_number ?? ""}</td>
        <td>${order.client ?? ""}</td>
        <td>${order.phone ?? ""}</td>
        <td>
          <span class="${
            order.payment_status === "оплачен" ? "status-paid" : "status-no"
          }">
            ${order.payment_status ?? ""}
          </span>
        </td>
        <td>${order.amount ?? ""}</td>
        <td>${order.prepayment ?? ""}</td>
        <td>${order.remaining_amount ?? ""}</td>
        <td>${order.delivery ?? ""}</td>
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

  const filteredOrders = state.allOrders.filter((order) =>
    (order.client || "").toLowerCase().includes(query)
  );

  renderOrders(filteredOrders);
}

export function getFormData() {
  return {
    order_date: document.getElementById("order_date").value || null,
    order_number: document.getElementById("order_number").value.trim() || null,
    client: document.getElementById("client").value.trim() || null,
    description: document.getElementById("description").value.trim() || null,
    payment_status: document.getElementById("payment_status").value.trim() || null,
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
    phone: document.getElementById("phone").value.trim() || null,
  };
}

export function fillForm(order) {
  document.getElementById("order_date").value = order.order_date || "";
  document.getElementById("order_number").value = order.order_number || "";
  document.getElementById("client").value = order.client || "";
  document.getElementById("description").value = order.description || "";
  document.getElementById("payment_status").value = order.payment_status || "";
  document.getElementById("amount").value = order.amount ?? "";
  document.getElementById("prepayment").value = order.prepayment ?? "";
  document.getElementById("prepayment_to").value = order.prepayment_to || "";
  document.getElementById("remaining_amount").value = order.remaining_amount ?? "";
  document.getElementById("remaining_to").value = order.remaining_to || "";
  document.getElementById("area_m2").value = order.area_m2 ?? "";
  document.getElementById("delivery").value = order.delivery || "";
  document.getElementById("delivery_date").value = order.delivery_date || "";
  document.getElementById("phone").value = order.phone || "";

  resetFileUpload();
}

export function resetFormMode() {
  state.editingOrderId = null;
  document.getElementById("orderForm").reset();
  resetFileUpload();

  message.textContent = "Режим: новая заявка";

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
    message.textContent = wasEditing
      ? "Ошибка при обновлении заявки"
      : "Ошибка при сохранении заявки";
    return;
  }

  await uploadFiles(savedOrderId);

  resetFormMode();
  await loadOrders();

  message.textContent = wasEditing
    ? `Заявка #${savedOrderId} обновлена`
    : `Заявка #${savedOrderId} сохранена`;
}