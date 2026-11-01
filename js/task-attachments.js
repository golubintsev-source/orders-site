import { state } from "./state.js";
import { isOrderHiddenForCurrentRole } from "./roles.js";
import { formatOrderIdTypeChip } from "./format.js";
import { getOrderSummary } from "./order-summary-cache.js";
import { buildOrderViewUrl } from "./app-routes.js";
import { getSignedFileUrl, getSignedFileUrls, isCroppableImageFile } from "./storage-urls.js";
import { normalizeTaskAttachments, taskOrderIdsFromBody } from "./task-attachment-data.js";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}


// Each form owns its draft and DOM references, so editing never changes a new task.
export function createTaskAttachmentComposer({ getElement = (id) => document.getElementById(id), initialAttachments = [], onError, onBusyChange, cropHost } = {}) {
  let cleanup = () => {};
  const photos = normalizeTaskAttachments(initialAttachments).filter((item) => item.type === "photo")
    .map((uploaded) => ({ file: null, previewUrl: "", uploaded }));
  const legacyOrders = normalizeTaskAttachments(initialAttachments).filter((item) => item.type === "order" && !taskOrderIdsFromBody(getElement("orderTaskTextInput")?.value).includes(item.orderId));
  let disposed = false;
  const releasePreview = (photo) => { if (photo?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(photo.previewUrl); };
  let busy = false;
  let pickerOpen = false;
  let pickerRequest = 0;
  let pickerTimer;
  let pickerModule;

  function isTaskAttachmentsBusy() {
    return busy;
  }


  function showError(error) {
    if (disposed) return;
    if (onError) { onError(error); return; }
    const message = getElement("myTasksFormMessage");
    if (message) {
      message.textContent = error?.message || "Не удалось добавить вложение. Попробуйте ещё раз.";
      message.classList.add("order-tasks-message--error");
    }
  }

  function setMenuOpen(open) {
    const menu = getElement("taskAttachMenu");
    const button = getElement("taskAttachBtn");
    if (menu) menu.hidden = !open;
    button?.setAttribute("aria-expanded", String(open));
    button?.classList.toggle("messages-composer-tool-btn--active", open);
    if (button) {
      button.title = open ? "Закрыть вложения" : "Вложение";
      button.setAttribute("aria-label", button.title);
    }
  }

  function renderPending() {
    const root = getElement("taskPendingAttachments");
    if (!root) return;
    root.hidden = photos.length === 0 && legacyOrders.length === 0;
    root.innerHTML = photos.map((photo, index) => `
      <div class="task-pending-photo">
        <img ${photo.previewUrl ? `src="${escapeHtml(photo.previewUrl)}"` : ""} alt="${escapeHtml(photo.file?.name || photo.uploaded?.fileName || "Фото")}" />
        <div class="task-pending-actions">
          ${isCroppableImageFile(photo.file || { name: photo.uploaded?.fileName, type: photo.uploaded?.mimeType }) ? `<button type="button" data-crop="${index}" ${busy ? "disabled" : ""}>Обрезать</button>` : ""}
          <button type="button" data-remove-photo="${index}" aria-label="Убрать фото" ${busy ? "disabled" : ""}>×</button>
        </div>
      </div>`).join("") + legacyOrders.map((item, index) => `<span class="task-pending-order">Заказ ${escapeHtml(formatOrderIdTypeChip(item.orderId, getOrderSummary(item.orderId)?.order_type))}<button type="button" data-remove-order="${index}" aria-label="Убрать заказ" ${busy ? "disabled" : ""}>×</button></span>`).join("");
  }

  function hasTaskDraftAttachments() {
    return photos.length > 0 || legacyOrders.length > 0;
  }

  function setTaskAttachmentsBusy(value) {
    busy = value;
    onBusyChange?.(value);
    const button = getElement("taskAttachBtn");
    if (button) button.disabled = value;
    if (value) {
      setMenuOpen(false);
      hideOrderSuggestions();
    }
    renderPending();
  }

  function clearTaskDraftAttachments() {
    for (const photo of photos) releasePreview(photo);
    photos.length = 0;
    legacyOrders.length = 0;
    hideOrderSuggestions();
    renderPending();
  }

  async function prepareTaskAttachments() {
    const attachments = taskOrderIdsFromBody(getElement("orderTaskTextInput")?.value)
      .map((orderId) => ({ type: "order", orderId }));
    attachments.push(...legacyOrders);
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

  function hideOrderSuggestions() {
    clearTimeout(pickerTimer);
    pickerOpen = false;
    pickerRequest++;
    const list = getElement("taskComposerSuggestions");
    if (list) { list.hidden = true; list.innerHTML = ""; }
    const button = getElement("taskPickOrderBtn");
    button?.setAttribute("aria-expanded", "false");
    button?.classList.remove("messages-composer-tool-btn--active");
  }

  function triggerContext(input) {
    const caret = input.selectionStart ?? input.value.length;
    const match = input.value.slice(0, caret).match(/&(\d*)$/);
    return match ? { query: match[1], start: caret - match[0].length } : null;
  }

  function pickOrder(input, order, context) {
    if (busy || input.disabled) return;
    const start = context?.start ?? input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const before = input.value.slice(0, start);
    const insert = `[[order:${order.id}]] `;
    input.value = before + insert + input.value.slice(end);
    hideOrderSuggestions();
    input.focus();
    input.setSelectionRange(before.length + insert.length, before.length + insert.length);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function showOrderSuggestions(input, context = null) {
    if (busy || input.disabled) return;
    pickerOpen = true;
    const request = ++pickerRequest;
    const text = input.value;
    const caret = input.selectionStart;
    const button = getElement("taskPickOrderBtn");
    button?.setAttribute("aria-expanded", "true");
    button?.classList.add("messages-composer-tool-btn--active");
    try {
      const runtime = await import("./orders-runtime.js");
      pickerModule = await runtime.ensureOrdersData({ current: () => pickerOpen && request === pickerRequest });
      if (!pickerOpen || request !== pickerRequest || busy || input.value !== text || input.selectionStart !== caret) return;
      const query = (context?.query || "").toLowerCase();
      const rows = (state.allOrders || []).filter((order) => {
        if (isOrderHiddenForCurrentRole(order)) return false;
        if (!context && order.payment_status === "Заказ закрыт") return false;
        return [order.id, formatOrderIdTypeChip(order.id, order.order_type), order.client, order.address, order.description]
          .some((value) => String(value || "").toLowerCase().includes(query));
      });
      const choices = context ? rows.slice(0, 15) : rows;
      const list = getElement("taskComposerSuggestions");
      if (!choices.length) { hideOrderSuggestions(); return; }
      list.innerHTML = choices.map((order, index) =>
        `<li role="option" data-index="${index}" aria-selected="${index === 0}">${pickerModule.buildOrderPickerRowHtml(order)}</li>`).join("");
      list.hidden = false;
      list.querySelectorAll("[data-fulltext]").forEach((cell) => {
        const full = cell.getAttribute("data-fulltext");
        if (full) cell.setAttribute("title", full);
      });
      list.querySelectorAll("li").forEach((item, index) => {
        item.addEventListener("mousedown", (event) => {
          event.preventDefault();
          pickOrder(input, choices[index], context);
        });
      });
    } catch (error) {
      if (request === pickerRequest) { hideOrderSuggestions(); showError(error); }
    }
  }

  function bindOrderComposer(input) {
    input.addEventListener("input", () => {
      clearTimeout(pickerTimer);
      hideOrderSuggestions();
      const context = triggerContext(input);
      if (context && !busy) {
        pickerTimer = setTimeout(() => { void showOrderSuggestions(input, context); }, 120);
      }
    });
    input.addEventListener("keydown", (event) => {
      const list = getElement("taskComposerSuggestions");
      if (!list || list.hidden || event.isComposing) return;
      const items = [...list.querySelectorAll("li")];
      let index = items.findIndex((item) => item.getAttribute("aria-selected") === "true");
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        index = event.key === "ArrowDown" ? Math.min(index + 1, items.length - 1) : Math.max(index - 1, 0);
        items.forEach((item, i) => item.setAttribute("aria-selected", String(i === index)));
        items[index]?.scrollIntoView({ block: "nearest" });
      } else if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        items[index]?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      } else if (event.key === "Escape") {
        event.preventDefault();
        hideOrderSuggestions();
      }
    });
    input.addEventListener("blur", () => setTimeout(hideOrderSuggestions, 150));
  }

  function initTaskAttachments() {
    const button = getElement("taskAttachBtn");
    if (!button || button.dataset.bound) return;
    button.dataset.bound = "1";
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      hideOrderSuggestions();
      setMenuOpen(getElement("taskAttachMenu").hidden);
    });
    const input = getElement("orderTaskTextInput");
    bindOrderComposer(input);
    getElement("taskPickOrderBtn").addEventListener("mousedown", (event) => event.preventDefault());
    getElement("taskPickOrderBtn").addEventListener("click", () => {
      setMenuOpen(false);
      if (pickerOpen) hideOrderSuggestions();
      else {
        input.focus();
        void showOrderSuggestions(input);
      }
    });
    for (const kind of ["Camera", "Gallery"]) {
      const input = getElement(`taskPhoto${kind}Input`);
      getElement(`taskAttach${kind}Btn`).addEventListener("click", () => {
        setMenuOpen(false);
        input.value = "";
        input.click();
      });
      input.addEventListener("change", () => { addPhotos(input.files); input.value = ""; });
    }
    getElement("orderTaskTextInput").addEventListener("paste", (event) => {
      const images = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith("image/"));
      if (images.length) { event.preventDefault(); addPhotos(images); }
    });
    getElement("taskPendingAttachments").addEventListener("click", async (event) => {
      const target = event.target.closest("button");
      if (!target || busy) return;
      if (target.hasAttribute("data-remove-photo")) {
        const [photo] = photos.splice(Number(target.dataset.removePhoto), 1);
        if (photo) releasePreview(photo);

      } else if (target.hasAttribute("data-remove-order")) {
        legacyOrders.splice(Number(target.dataset.removeOrder), 1);
      } else if (target.hasAttribute("data-crop")) {
        const photo = photos[Number(target.dataset.crop)];
        if (!photo) return;
        // Lock draft controls while the crop dialog is open.
        setTaskAttachmentsBusy(true);
        const createButton = getElement("orderTaskCreateBtn");
        const wasDisabled = createButton?.disabled;
        if (createButton) createButton.disabled = true;
        try {
          const { cropImageAttachment } = await import("./files.js");
          let source = photo.file;
          if (!source) {
            const url = await getSignedFileUrl(photo.uploaded.storagePath);
            if (!url) throw new Error("Фото недоступно. Попробуйте ещё раз.");
            const response = await fetch(url);
            if (!response.ok) throw new Error("Не удалось загрузить фото для обрезки.");
            const blob = await response.blob();
            source = new File([blob], photo.uploaded.fileName || "Фото.jpg", { type: blob.type || photo.uploaded.mimeType });
          }
          // The shared crop overlay must be inside the native dialog's top layer.
          const cropModal = cropHost ? document.getElementById("cropImageModal") : null;
          const parent = cropModal?.parentNode;
          const next = cropModal?.nextSibling;
          let cropped;
          try {
            if (cropModal) cropHost.append(cropModal);
            cropped = await cropImageAttachment(source);
          } finally {
            if (cropModal && parent) parent.insertBefore(cropModal, next);
          }
          if (cropped && cropped !== source && !disposed) {
            releasePreview(photo);
            photo.file = cropped;
            photo.previewUrl = URL.createObjectURL(cropped);
            photo.uploaded = null;
          }
        } catch (error) { showError(error); }
        finally { setTaskAttachmentsBusy(false); if (createButton) createButton.disabled = wasDisabled; }
      }
      renderPending();
    });
    const onDocumentClick = (event) => {
      if (!event.target.closest(".task-attach-wrap")) setMenuOpen(false);
      if (!event.target.closest(".task-composer-row")) hideOrderSuggestions();
    };
    const onDocumentKeydown = (event) => {
      if (event.key === "Escape") { setMenuOpen(false); hideOrderSuggestions(); }
    };
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("keydown", onDocumentKeydown);
    cleanup = () => {
      document.removeEventListener("click", onDocumentClick);
      document.removeEventListener("keydown", onDocumentKeydown);
    };
    renderPending();
    for (const photo of photos) {
      if (!photo.uploaded) continue;
      const uploaded = photo.uploaded;
      void Promise.resolve(getSignedFileUrl(uploaded.thumbnailPath || uploaded.storagePath)).then((url) => {
        if (!disposed && photos.includes(photo) && photo.uploaded === uploaded) { photo.previewUrl = url || ""; renderPending(); }
      }).catch(showError);
    }
  }


  return {
    init: initTaskAttachments, isBusy: isTaskAttachmentsBusy, hasAttachments: hasTaskDraftAttachments,
    setBusy: setTaskAttachmentsBusy, clear: clearTaskDraftAttachments, prepare: prepareTaskAttachments,
    dispose() { disposed = true; hideOrderSuggestions(); cleanup(); for (const photo of photos) releasePreview(photo); },
  };
}

const defaultComposer = createTaskAttachmentComposer();
export const initTaskAttachments = () => defaultComposer.init();
export const isTaskAttachmentsBusy = () => defaultComposer.isBusy();
export const hasTaskDraftAttachments = () => defaultComposer.hasAttachments();
export const setTaskAttachmentsBusy = (value) => defaultComposer.setBusy(value);
export const clearTaskDraftAttachments = () => defaultComposer.clear();
export const prepareTaskAttachments = () => defaultComposer.prepare();

let viewer;
let photoObserver;
const observedByRoot = new WeakMap();
let viewerRequest = 0;
function showError(error) {
  const message = document.getElementById("myTasksFormMessage");
  if (message) { message.textContent = error?.message || "Не удалось открыть фото."; message.classList.add("order-tasks-message--error"); }
}

export function renderTaskBodyHtml(body) {
  return String(body || "").split(/(\[\[order:\d+\]\])/g).map((part) => {
    const match = part.match(/^\[\[order:(\d+)\]\]$/);
    const id = match ? Number(match[1]) : 0;
    if (!Number.isSafeInteger(id) || id <= 0) return escapeHtml(part);
    const order = getOrderSummary(id);
    return `<a class="my-tasks-order-link message-order-link" href="${escapeHtml(buildOrderViewUrl(id))}" data-order-id="${id}">${escapeHtml(formatOrderIdTypeChip(id, order?.order_type))}</a>`;
  }).join("");
}

export function renderTaskAttachmentsHtml(row) {
  const bodyOrderIds = new Set(taskOrderIdsFromBody(row.body));
  const items = normalizeTaskAttachments(row.attachments)
    .filter((item) => item.type !== "order" || !bodyOrderIds.has(item.orderId));
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
