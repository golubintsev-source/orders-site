const SUPABASE_URL = "https://yizwpogwabosuguakyzt.supabase.co"
const SUPABASE_KEY = "sb_publishable_e1pJB18UsEV-o_M43ROi9w_4mS--LrF"


const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const form = document.getElementById("orderForm");
const message = document.getElementById("message");
const loadBtn = document.getElementById("loadBtn");
const logoutBtn = document.getElementById("logoutBtn");
const userInfo = document.getElementById("userInfo");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const submitBtn = document.getElementById("submitBtn");
const formTitle = document.getElementById("formTitle");

let currentUser = null;
let currentRole = "user";
let editingOrderId = null;

async function checkAuth() {
  const { data, error } = await supabaseClient.auth.getUser();

  if (error || !data.user) {
    window.location.href = "login.html";
    return null;
  }

  currentUser = data.user;
  return data.user;
}

async function loadProfile() {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("role")
    .eq("id", currentUser.id)
    .single();

  if (error) {
    console.error("Ошибка загрузки профиля:", error);
    userInfo.textContent = `Вы вошли как: ${currentUser.email}`;
    currentRole = "user";
    return;
  }

  currentRole = data.role || "user";
  userInfo.textContent = `Вы вошли как: ${currentUser.email} | Роль: ${currentRole}`;
}

async function loadOrders() {
  const { data, error } = await supabaseClient
    .from("orders")
    .select("*")
    .order("id", { ascending: false });

  if (error) {
    console.error("Ошибка загрузки:", error);
    message.textContent = "Ошибка загрузки заявок";
    return;
  }

  const table = document.querySelector("#ordersTable tbody");
  table.innerHTML = "";

  data.forEach((order) => {
    const editButton = `
      <button type="button" onclick="editOrder(${order.id})">
        Редактировать
      </button>
    `;

    const deleteButton =
      currentRole === "admin"
        ? `<button type="button" onclick="deleteOrder(${order.id})">Удалить</button>`
        : "";

    const row = `
      <tr>
        <td>${order.id ?? ""}</td>
        <td>${order.order_date ?? ""}</td>
        <td>${order.order_number ?? ""}</td>
        <td>${order.client ?? ""}</td>
        <td>${order.phone ?? ""}</td>
        <td>${order.payment_status ?? ""}</td>
        <td>${order.amount ?? ""}</td>
        <td>${order.prepayment ?? ""}</td>
        <td>${order.remaining_amount ?? ""}</td>
        <td>${order.delivery ?? ""}</td>
        <td>${order.delivery_date ?? ""}</td>
        <td>
          ${editButton}
          ${deleteButton}
        </td>
      </tr>
    `;

    table.innerHTML += row;
  });
}

function getFormData() {
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

function fillForm(order) {
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
}

function resetFormMode() {
  editingOrderId = null;
  form.reset();
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

async function editOrder(orderId) {
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

  editingOrderId = orderId;
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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "Сохраняю...";

  const orderData = getFormData();

  let error = null;

  if (editingOrderId) {
    const result = await supabaseClient
      .from("orders")
      .update(orderData)
      .eq("id", editingOrderId);

    error = result.error;
  } else {
    const result = await supabaseClient
      .from("orders")
      .insert([orderData]);

    error = result.error;
  }

  if (error) {
    console.error("Ошибка сохранения:", error);
    message.textContent = editingOrderId
      ? "Ошибка при обновлении заявки"
      : "Ошибка при сохранении заявки";
    return;
  }

  message.textContent = editingOrderId
    ? `Заявка #${editingOrderId} обновлена`
    : "Заявка сохранена";

  resetFormMode();
  await loadOrders();
});

loadBtn.addEventListener("click", loadOrders);

if (cancelEditBtn) {
  cancelEditBtn.addEventListener("click", () => {
    resetFormMode();
  });
}

logoutBtn.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
});

async function deleteOrder(orderId) {
  if (currentRole !== "admin") return;

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

window.deleteOrder = deleteOrder;
window.editOrder = editOrder;

async function init() {
  const user = await checkAuth();
  if (!user) return;

  await loadProfile();
  await loadOrders();
  resetFormMode();
}

init();