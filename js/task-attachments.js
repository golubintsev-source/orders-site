import { state } from "./state.js";
import { isOrderHiddenForCurrentRole } from "./roles.js";
import { formatOrderIdTypeChip } from "./format.js";
import { getOrderSummary } from "./order-summary-cache.js";
import { buildOrderViewUrl } from "./app-routes.js";
import { getSignedFileUrl, getSignedFileUrls, isCroppableImageFile } from "./storage-urls.js";
import { normalizeTaskAttachments } from "./task-attachment-data.js";

const photos = [];
const orders = new Map();
let busy = false;
let picker;
let viewer;
let pickerModule;
let photoObserver;
const observedByRoot = new WeakMap();
let viewerRequest = 0;

export function isTaskAttachmentsBusy() {
  return busy;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function showError(error) {
  const message = document.getElementById("myTasksFormMessage");
  if (message) {
    message.textContent = error?.message || "Не удалось добавить вложение. Попробуйте ещё раз.";
    message.classList.add("order-tasks-message--error");
  }
}

function setMenuOpen(open) {
  const menu = document.getElementById("taskAttachMenu");
  const button = document.getElementById("taskAttachBtn");
  if (menu) menu.hidden = !open;
  button?.setAttribute("aria-expanded", String(open));
  button?.classList.toggle("messages-composer-tool-btn--active", open);
}

function renderPending() {
  const root = document.getElementById("taskPendingAttachments");
  if (!root) return;
  root.hidden = photos.length + orders.size === 0;
  root.innerHTML = photos.map((photo, index) => `
    <div class="task-pending-photo">
      <img src="${escapeHtml(photo.previewUrl)}" alt="${escapeHtml(photo.file.name || "Фото")}" />
      <div class="task-pending-actions">
        ${isCroppableImageFile(photo.file) ? `<button type="button" data-crop="${index}" ${busy ? "disabled" : ""}>Обрезать</button>` : ""}
        <button type="button" data-remove-photo="${index}" aria-label="Убрать фото" ${busy ? "disabled" : ""}>×</button>
      </div>
    </div>`).join("") + [...orders.values()].map((order) => `
    <div class="task-pending-order">Заказ ${escapeHtml(formatOrderIdTypeChip(order.id, order.order_type))}
      <button type="button" data-remove-order="${order.id}" aria-label="Убрать заказ" ${busy ? "disabled" : ""}>×</button>
    </div>`).join("");
}

export function hasTaskDraftAttachments() {
  return photos.length + orders.size > 0;
}

export function setTaskAttachmentsBusy(value) {
  busy = value;
  const button = document.getElementById("taskAttachBtn");
  if (button) button.disabled = value;
  if (value) {
    setMenuOpen(false);
    if (picker?.open) picker.close();
  }
  renderPending();
}

export function clearTaskDraftAttachments() {
  for (const photo of photos) URL.revokeObjectURL(photo.previewUrl);
  photos.length = 0;
  orders.clear();
  renderPending();
}

export async function prepareTaskAttachments() {
  const attachments = [...orders.keys()].map((orderId) => ({ type: "order", orderId }));
  if (photos.length) {
    const { uploadChatPhoto } = await import("./files.js");
    for (const photo of photos) {
      // Keep successful uploads on failure, so retry does not upload them again.
      if (!photo.uploaded) photo.uploaded = await uploadChatPhoto(photo.file);
      attachments.push({ type: "photo", ...photo.uploaded });
    }
  }
  return normalizeTaskAttachments(attachments);
}

function addPhotos(files) {
  if (busy) return;
  for (const file of files || []) {
    if (!file.type?.startsWith("image/")) {
      showError(new Error("Можно прикрепить только изображение."));
      continue;
    }
    photos.push({ file, previewUrl: URL.createObjectURL(file), uploaded: null });
  }
  renderPending();
}

function createPicker() {
  picker = document.createElement("dialog");
  picker.className = "task-order-picker";
  picker.setAttribute("aria-label", "Прикрепить заказ");
  picker.innerHTML = `<div class="task-dialog-header"><strong>Прикрепить заказ</strong><button type="button" data-close aria-label="Закрыть">×</button></div>
    <input type="search" placeholder="Номер, клиент, адрес или описание" aria-label="Поиск заказа" />
    <p role="status"></p><div class="task-order-picker-results"></div>`;
  document.body.append(picker);
  picker.querySelector("[data-close]").addEventListener("click", () => picker.close());
  picker.querySelector("input").addEventListener("input", renderOrderChoices);
  picker.querySelector(".task-order-picker-results").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-order-id]");
    if (!button || busy) return;
    const order = (state.allOrders || []).find((row) => Number(row.id) === Number(button.dataset.orderId));
    if (!order || isOrderHiddenForCurrentRole(order)) return;
    orders.set(Number(order.id), order);
    renderPending();
    picker.close();
  });
}

function renderOrderChoices() {
  if (!pickerModule) return;
  const query = picker.querySelector("input").value.trim().toLowerCase();
  const rows = (state.allOrders || []).filter((order) => {
    if (order.payment_status === "Заказ закрыт" || isOrderHiddenForCurrentRole(order)) return false;
    return [order.id, formatOrderIdTypeChip(order.id, order.order_type), order.client, order.address, order.description]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });
  picker.querySelector("[role=status]").textContent = rows.length ? "" : "Заказы не найдены.";
  picker.querySelector(".task-order-picker-results").innerHTML = rows.map((order) =>
    `<button type="button" data-order-id="${Number(order.id)}">${pickerModule.buildOrderPickerRowHtml(order)}</button>`).join("");
}

async function openOrderPicker() {
  if (!picker) createPicker();
  picker.querySelector("input").value = "";
  picker.querySelector("input").disabled = true;
  picker.querySelector("[role=status]").textContent = "Загрузка заказов…";
  picker.querySelector(".task-order-picker-results").innerHTML = "";
  picker.showModal();
  try {
    const runtime = await import("./orders-runtime.js");
    pickerModule = await runtime.ensureOrdersData({ current: () => picker.open });
    if (picker.open && pickerModule) {
      picker.querySelector("input").disabled = false;
      renderOrderChoices();
      picker.querySelector("input").focus();
    }
  } catch {
    if (picker.open) picker.querySelector("[role=status]").textContent = "Не удалось загрузить заказы. Закройте окно и попробуйте ещё раз.";
  }
}

export function initTaskAttachments() {
  const button = document.getElementById("taskAttachBtn");
  if (!button || button.dataset.bound) return;
  button.dataset.bound = "1";
  button.addEventListener("click", () => setMenuOpen(document.getElementById("taskAttachMenu").hidden));
  document.getElementById("taskPickOrderBtn").addEventListener("click", () => {
    setMenuOpen(false);
    void openOrderPicker().catch(showError);
  });
  for (const kind of ["Camera", "Gallery"]) {
    const input = document.getElementById(`taskPhoto${kind}Input`);
    document.getElementById(`taskAttach${kind}Btn`).addEventListener("click", () => {
      setMenuOpen(false);
      input.value = "";
      input.click();
    });
    input.addEventListener("change", () => { addPhotos(input.files); input.value = ""; });
  }
  document.getElementById("orderTaskTextInput").addEventListener("paste", (event) => {
    const images = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith("image/"));
    if (images.length) { event.preventDefault(); addPhotos(images); }
  });
  document.getElementById("taskPendingAttachments").addEventListener("click", async (event) => {
    const target = event.target.closest("button");
    if (!target || busy) return;
    if (target.hasAttribute("data-remove-photo")) {
      const [photo] = photos.splice(Number(target.dataset.removePhoto), 1);
      if (photo) URL.revokeObjectURL(photo.previewUrl);
    } else if (target.hasAttribute("data-remove-order")) {
      orders.delete(Number(target.dataset.removeOrder));
    } else if (target.hasAttribute("data-crop")) {
      const photo = photos[Number(target.dataset.crop)];
      if (!photo) return;
      // Lock draft controls while the crop dialog is open.
      setTaskAttachmentsBusy(true);
      const createButton = document.getElementById("orderTaskCreateBtn");
      const wasDisabled = createButton.disabled;
      createButton.disabled = true;
      try {
        const { cropImageAttachment } = await import("./files.js");
        const cropped = await cropImageAttachment(photo.file);
        if (cropped) {
          URL.revokeObjectURL(photo.previewUrl);
          photo.file = cropped;
          photo.previewUrl = URL.createObjectURL(cropped);
          photo.uploaded = null;
        }
      } catch (error) { showError(error); }
      finally { setTaskAttachmentsBusy(false); createButton.disabled = wasDisabled; }
    }
    renderPending();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".task-attach-wrap")) setMenuOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setMenuOpen(false);
  });
}

export function renderTaskAttachmentsHtml(row) {
  const items = normalizeTaskAttachments(row.attachments);
  if (!items.length) return "";
  return `<div class="task-attachments">${items.map((item) => {
    if (item.type === "order") {
      const order = getOrderSummary(item.orderId);
      return `<a class="my-tasks-order-link task-attached-order" href="${escapeHtml(buildOrderViewUrl(item.orderId))}" data-order-id="${item.orderId}">Заказ ${escapeHtml(formatOrderIdTypeChip(item.orderId, order?.order_type))}</a>`;
    }
    return `<button type="button" class="task-attached-photo" data-storage-path="${escapeHtml(item.storagePath)}" data-thumb-path="${escapeHtml(item.thumbnailPath || item.storagePath)}" aria-label="Открыть фото: ${escapeHtml(item.fileName)}"><img alt="${escapeHtml(item.fileName)}" loading="lazy" /><span>Загрузка фото…</span></button>`;
  }).join("")}</div>`;
}

async function loadPhotoPreviews(nodes) {
  try {
    const urls = await getSignedFileUrls(nodes.map((node) => node.dataset.thumbPath));
    for (const node of nodes) {
      if (!node.isConnected) continue;
      const image = node.querySelector("img");
      const label = node.querySelector("span");
      image.onload = () => { label.hidden = true; };
      image.onerror = async () => {
        // A thumbnail can be missing even though the original is available.
        if (node.dataset.fullFallback !== "1") {
          node.dataset.fullFallback = "1";
          try {
            const fullUrl = await getSignedFileUrl(node.dataset.storagePath);
            if (fullUrl) { image.src = fullUrl; return; }
          } catch { /* show the retry button label below */ }
        }
        label.hidden = false;
        label.textContent = "Открыть фото";
      };
      const url = urls.get(node.dataset.thumbPath);
      if (url) image.src = url;
      else { label.textContent = "Открыть фото"; }
    }
  } catch {
    for (const node of nodes) node.querySelector("span").textContent = "Открыть фото";
  }
}

async function openPhoto(node) {
  if (!viewer) {
    viewer = document.createElement("dialog");
    viewer.className = "task-photo-viewer";
    viewer.setAttribute("aria-label", "Фото задачи");
    viewer.innerHTML = `<div class="task-dialog-header"><strong>Фото задачи</strong><button type="button" aria-label="Закрыть">×</button></div><p role="status"></p><img alt="Фото задачи" />`;
    viewer.querySelector("button").addEventListener("click", () => viewer.close());
    viewer.addEventListener("close", () => {
      viewerRequest++;
      viewer.querySelector("img").removeAttribute("src");
    });
    document.body.append(viewer);
  }
  const image = viewer.querySelector("img");
  const status = viewer.querySelector("[role=status]");
  image.removeAttribute("src");
  image.hidden = true;
  status.textContent = "Загрузка фото…";
  viewer.showModal();
  const request = ++viewerRequest;
  try {
    const url = await getSignedFileUrl(node.dataset.storagePath);
    if (!viewer.open || request !== viewerRequest) return;
    if (!url) throw new Error("Фото недоступно. Попробуйте ещё раз.");
    image.alt = node.querySelector("img").alt;
    image.onload = () => { status.textContent = ""; };
    image.onerror = () => { status.textContent = "Не удалось загрузить фото. Попробуйте ещё раз."; };
    image.src = url;
    image.hidden = false;
  } catch (error) {
    if (request === viewerRequest) status.textContent = error.message || "Не удалось открыть фото.";
  }
}

export function hydrateTaskAttachments(root) {
  if (!root) return;
  if (!root.dataset.taskPhotosBound) {
    root.dataset.taskPhotosBound = "1";
    root.addEventListener("click", (event) => {
      const photo = event.target.closest(".task-attached-photo");
      if (photo) { event.preventDefault(); event.stopPropagation(); void openPhoto(photo).catch(showError); }
    });
  }
  if (typeof IntersectionObserver !== "undefined" && !photoObserver) {
    photoObserver = new IntersectionObserver((entries) => {
      const nodes = entries.filter((entry) => entry.isIntersecting).map((entry) => entry.target);
      for (const node of nodes) photoObserver.unobserve(node);
      if (nodes.length) void loadPhotoPreviews(nodes);
    }, { rootMargin: "200px" });
  }
  for (const node of observedByRoot.get(root) || []) photoObserver?.unobserve(node);
  const nodes = [...root.querySelectorAll(".task-attached-photo")];
  observedByRoot.set(root, nodes);
  for (const node of nodes) {
    if (photoObserver) photoObserver.observe(node);
  }
  if (!photoObserver) void loadPhotoPreviews(nodes);
}
