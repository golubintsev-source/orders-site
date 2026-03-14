const SUPABASE_URL = "https://yizwpogwabosuguakyzt.supabase.co";
const SUPABASE_KEY = "sb_publishable_e1pJB18UsEV-o_M43ROi9w_4mS--LrF";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const form = document.getElementById("orderForm");
const message = document.getElementById("message");
const loadBtn = document.getElementById("loadBtn");
const logoutBtn = document.getElementById("logoutBtn");
const userInfo = document.getElementById("userInfo");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const submitBtn = document.getElementById("submitBtn");
const formTitle = document.getElementById("formTitle");
const clientSearch = document.getElementById("clientSearch");

const attachmentsInput = document.getElementById("attachments");
const fileUploadText = document.getElementById("fileUploadText");
const selectFilesBtn = document.getElementById("selectFilesBtn");
const selectedFiles = document.getElementById("selectedFiles");

const filesModal = document.getElementById("filesModal");
const filesModalBody = document.getElementById("filesModalBody");
const filesModalTitle = document.getElementById("filesModalTitle");
const closeFilesModal = document.getElementById("closeFilesModal");

let currentUser = null;
let currentRole = "user";
let editingOrderId = null;
let allOrders = [];
let filesCountMap = {};

/* =========================
   FILE UPLOAD UI
========================= */

function renderSelectedFiles() {
  const files = Array.from(attachmentsInput.files || []);

  if (files.length === 0) {
    fileUploadText.textContent = "Файлы не выбраны";
    selectedFiles.innerHTML = "";
    return;
  }

  fileUploadText.textContent = `Выбрано файлов: ${files.length}`;
  selectedFiles.innerHTML = "";

  files.forEach((file) => {
    const div = document.createElement("div");
    div.className = "file-item";
    div.textContent = file.name;
    selectedFiles.appendChild(div);
  });
}

function resetFileUpload() {
  attachmentsInput.value = "";
  fileUploadText.textContent = "Файлы не выбраны";
  selectedFiles.innerHTML = "";
}

if (selectFilesBtn) {
  selectFilesBtn.addEventListener("click", () => {
    attachmentsInput.click();
  });
}

if (attachmentsInput) {
  attachmentsInput.addEventListener("change", renderSelectedFiles);
}

/* =========================
   AUTH
========================= */

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

/* =========================
   ORDERS
========================= */

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

  allOrders = data || [];
  await loadFilesCountMap();
  applyClientFilter();
}

function renderOrders(orders) {
  const table = document.querySelector("#ordersTable tbody");
  table.innerHTML = "";

  orders.forEach((order) => {
    const editButton = `
      <button type="button" onclick="editOrder(${order.id})">
        Редактировать
      </button>
    `;

    const deleteButton =
      currentRole === "admin"
        ? `<button type="button" onclick="deleteOrder(${order.id})">Удалить</button>`
        : "";

    const filesCount = filesCountMap[order.id] || 0;

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

function applyClientFilter() {
  const query = clientSearch?.value.trim().toLowerCase() || "";

  if (!query) {
    renderOrders(allOrders);
    return;
  }

  const filteredOrders = allOrders.filter((order) =>
    (order.client || "").toLowerCase().includes(query)
  );

  renderOrders(filteredOrders);
}

if (clientSearch) {
  clientSearch.addEventListener("input", applyClientFilter);
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

  resetFileUpload();
}

function resetFormMode() {
  editingOrderId = null;
  form.reset();
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

/* =========================
   FORM SUBMIT
========================= */

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "Сохраняю...";

  const orderData = getFormData();

  let error = null;
  let savedOrderId = editingOrderId;
  const wasEditing = Boolean(editingOrderId);

  if (editingOrderId) {
    const result = await supabaseClient
      .from("orders")
      .update(orderData)
      .eq("id", editingOrderId)
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
});

/* =========================
   FILES UPLOAD
========================= */

async function uploadFiles(orderId) {
  const files = attachmentsInput?.files;

  if (!files || files.length === 0) {
    resetFileUpload();
    return;
  }

  for (const file of files) {
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const filePath = `${currentUser.id}/${orderId}/${Date.now()}_${safeName}`;

    const { error: uploadError } = await supabaseClient.storage
      .from("order-files")
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || "application/octet-stream",
      });

    if (uploadError) {
      console.error("Ошибка загрузки файла:", uploadError);
      message.textContent = `Ошибка загрузки файла: ${file.name}`;
      continue;
    }

    const { error: dbError } = await supabaseClient
      .from("order_files")
      .insert([
        {
          order_id: orderId,
          file_name: file.name,
          storage_path: filePath,
          mime_type: file.type || null,
          file_size: file.size || null,
          uploaded_by: currentUser.id,
        },
      ]);

    if (dbError) {
      console.error("Ошибка записи файла в БД:", dbError);
      message.textContent = `Файл загружен, но не записан в БД: ${file.name}`;
    }
  }

  resetFileUpload();
}

async function loadFilesCountMap() {
  const { data, error } = await supabaseClient
    .from("order_files")
    .select("order_id");

  if (error) {
    console.error("Ошибка загрузки количества файлов:", error);
    filesCountMap = {};
    return;
  }

  const map = {};

  (data || []).forEach((file) => {
    map[file.order_id] = (map[file.order_id] || 0) + 1;
  });

  filesCountMap = map;
}

function getFilesWord(count) {
  if (count % 10 === 1 && count % 100 !== 11) return "";
  if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) {
    return "а";
  }
  return "ов";
}

async function loadOrderFiles(orderId) {
  const { data, error } = await supabaseClient
    .from("order_files")
    .select("*")
    .eq("order_id", orderId)
    .order("id", { ascending: false });

  if (error) {
    console.error("Ошибка загрузки файлов:", error);
    return [];
  }

  return data || [];
}

async function getSignedFileUrl(storagePath) {
  const { data, error } = await supabaseClient.storage
    .from("order-files")
    .createSignedUrl(storagePath, 60 * 10);

  if (error) {
    console.error("Ошибка получения ссылки:", error);
    return null;
  }

  return data?.signedUrl || null;
}

async function openFilesModal(orderId) {
  filesModalTitle.textContent = `Файлы заказа #${orderId}`;
  filesModalBody.innerHTML = "Загрузка...";
  filesModal.style.display = "flex";

  const files = await loadOrderFiles(orderId);

  if (!files.length) {
    filesModalBody.innerHTML = "<p>У этого заказа пока нет файлов.</p>";
    return;
  }

  let html = `<div class="files-list">`;

  for (const file of files) {
    const signedUrl = await getSignedFileUrl(file.storage_path);
    const isImage = isImageFile(file);

    html += `
      <div class="file-row">
        <div class="file-preview">
          ${
            isImage && signedUrl
              ? `<a href="${signedUrl}" target="_blank"><img src="${signedUrl}" alt="${file.file_name}" class="file-thumb"></a>`
              : `<div class="file-icon">📄</div>`
          }
        </div>

        <div class="file-info">
          <strong>${file.file_name}</strong><br>
          <small>${file.mime_type || "неизвестный тип"} | ${formatFileSize(file.file_size)}</small>
        </div>

        <div class="file-actions">
          ${
            signedUrl
              ? `<a href="${signedUrl}" target="_blank">Открыть</a>`
              : ""
          }
          ${
            signedUrl
              ? `<a href="${signedUrl}" download="${file.file_name}">Скачать</a>`
              : ""
          }
          ${
            currentRole === "admin"
              ? `<button type="button" onclick="removeFile(${file.id}, '${file.storage_path}', ${orderId})">Удалить</button>`
              : ""
          }
        </div>
      </div>
    `;
  }

  html += `</div>`;
  filesModalBody.innerHTML = html;
}

async function removeFile(fileId, storagePath, orderId) {
  const ok = confirm("Удалить файл?");
  if (!ok) return;

  const { error: storageError } = await supabaseClient.storage
    .from("order-files")
    .remove([storagePath]);

  if (storageError) {
    console.error("Ошибка удаления файла из Storage:", storageError);
    message.textContent = "Ошибка удаления файла";
    return;
  }

  const { error: dbError } = await supabaseClient
    .from("order_files")
    .delete()
    .eq("id", fileId);

  if (dbError) {
    console.error("Ошибка удаления записи файла:", dbError);
    message.textContent = "Файл удалён из Storage, но не удалён из БД";
    return;
  }

  message.textContent = "Файл удалён";
  await loadFilesCountMap();
  applyClientFilter();
  await openFilesModal(orderId);
}

function isImageFile(file) {
  return (file.mime_type || "").startsWith("image/");
}

function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return "-";
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

/* =========================
   UI EVENTS
========================= */

loadBtn.addEventListener("click", loadOrders);

if (closeFilesModal) {
  closeFilesModal.addEventListener("click", () => {
    filesModal.style.display = "none";
  });
}

if (filesModal) {
  filesModal.addEventListener("click", (e) => {
    if (e.target === filesModal) {
      filesModal.style.display = "none";
    }
  });
}

if (cancelEditBtn) {
  cancelEditBtn.addEventListener("click", () => {
    resetFormMode();
  });
}

logoutBtn.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
});

/* =========================
   GLOBALS
========================= */

window.deleteOrder = deleteOrder;
window.editOrder = editOrder;
window.openFilesModal = openFilesModal;
window.removeFile = removeFile;

/* =========================
   INIT
========================= */

async function init() {
  const user = await checkAuth();
  if (!user) return;

  await loadProfile();
  await loadOrders();
  resetFormMode();
}

init();