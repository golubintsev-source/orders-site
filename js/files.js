import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import { isAdmin, isOrderHiddenForCurrentRole, isUserLite } from "./roles.js";
import { formatOrderIdTypeChip } from "./format.js";
import {
  downloadAttachmentOnIos,
  isIosDevice,
  isSpreadsheetAttachment,
  needsIosBlobDelivery,
  openAttachmentOnIos,
} from "./attachmentActions.js";
import { openSpreadsheetViewer } from "./spreadsheetViewer.js";
import {
  attachmentsInput,
  fileUploadText,
  clipboardPasteHint,
  selectedFiles,
  filesModal,
  filesModalBody,
  filesModalTitle,
  setMessage,
} from "./dom.js";
import { ensureCropperLibs } from "./lazy-cdn.js";

/** Выбранные к загрузке файлы; повторный выбор через «Загрузить» добавляет к списку, а не заменяет. */
const pendingAttachments = [];

/** Blob-URL превью в списке «выбранные файлы» — отзываем при следующей отрисовке. */
let selectedPreviewBlobUrls = [];

function applyPendingToAttachmentsInput() {
  if (!attachmentsInput) return;
  const dt = new DataTransfer();
  pendingAttachments.forEach((f) => dt.items.add(f));
  attachmentsInput.files = dt.files;
}

export function isCroppableImageFile(file) {
  if (!file?.type?.startsWith("image/")) return false;
  if (file.type === "image/svg+xml" || file.type === "image/gif") return false;
  return true;
}

/**
 * Загрузить библиотеки обрезки и открыть модалку (как при выборе фото к заявке).
 * @returns {Promise<File | null>} null — отмена
 */
export async function cropImageAttachment(file) {
  if (!isCroppableImageFile(file)) return file;
  try {
    await ensureCropperLibs();
  } catch (e) {
    console.warn("Библиотеки обрезки фото:", e);
  }
  try {
    return await openCropModalForAttachment(file);
  } catch (e) {
    console.warn("Обрезка фото:", e);
    return file;
  }
}

/**
 * Сжатие + миниатюра + загрузка фото в bucket order-files (путь …/messages/…).
 * Правила сжатия — те же, что для файлов заявки.
 * @returns {Promise<{ storagePath: string, thumbnailPath: string | null, mimeType: string, fileName: string, fileSize: number }>}
 */
export async function uploadChatPhoto(file) {
  if (!state.currentUser?.id) {
    throw new Error("Нет авторизации для загрузки фото");
  }
  if (!file) {
    throw new Error("Нет файла для загрузки");
  }

  const fileToUpload = await compressImageForWebIfNeeded(file);
  const rawName = (fileToUpload.name || file.name || "").trim() || "photo.jpg";
  const safeName = rawName.replace(/[^\w.\-]+/g, "_").replace(/^\.+$/, "") || "photo.jpg";
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const filePath = `${state.currentUser.id}/messages/${stamp}_${safeName}`;

  const uploadBody = await blobBodyForStorageUpload(fileToUpload);
  const { error: uploadError } = await supabaseClient.storage
    .from("order-files")
    .upload(filePath, uploadBody, {
      cacheControl: "3600",
      upsert: false,
      contentType: fileToUpload.type || "application/octet-stream",
    });

  if (uploadError) {
    const hint = uploadError.message ? ` (${uploadError.message})` : "";
    throw new Error(`Ошибка загрузки фото${hint}`);
  }

  let thumbnailStoragePath = null;
  const isRasterImage =
    fileToUpload.type?.startsWith("image/") &&
    fileToUpload.type !== "image/svg+xml" &&
    fileToUpload.type !== "image/gif";

  if (isRasterImage) {
    const thumbBlob = await buildThumbnailBlob(fileToUpload);
    if (thumbBlob && thumbBlob.size > 0) {
      const thumbExt = thumbBlob.type === "image/jpeg" ? "jpg" : "webp";
      thumbnailStoragePath = `${state.currentUser.id}/messages/${stamp}_thumb.${thumbExt}`;
      const thumbUploadBody = await blobBodyForStorageUpload(thumbBlob);
      const { error: thumbErr } = await supabaseClient.storage.from("order-files").upload(thumbnailStoragePath, thumbUploadBody, {
        cacheControl: "86400",
        upsert: false,
        contentType: thumbBlob.type || "image/webp",
      });
      if (thumbErr) {
        console.warn("Миниатюра сообщения не загружена:", thumbErr);
        thumbnailStoragePath = null;
      }
    }
  }

  return {
    storagePath: filePath,
    thumbnailPath: thumbnailStoragePath,
    mimeType: fileToUpload.type || "image/jpeg",
    fileName: file.name || fileToUpload.name || safeName,
    fileSize: fileToUpload.size ?? 0,
  };
}

/**
 * EXIF Orientation (снимки с iPhone): раскладываем пиксели в «правильный» вид до Cropper,
 * иначе на шаге обрезки картинка может оказаться повёрнутой на 90°.
 * Результат — object URL JPEG; при ошибке — исходный blob URL.
 */
function createOrientedImageObjectUrl(file) {
  return new Promise((resolve) => {
    const fallback = () => resolve(URL.createObjectURL(file));

    if (typeof window.loadImage !== "function") {
      fallback();
      return;
    }

    window.loadImage(
      file,
      (result) => {
        if (!result || typeof result.getContext !== "function") {
          fallback();
          return;
        }
        const canvas = result;
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              fallback();
              return;
            }
            resolve(URL.createObjectURL(blob));
          },
          "image/jpeg",
          0.92
        );
      },
      {
        orientation: true,
        canvas: true,
        maxWidth: 8192,
        maxHeight: 8192,
      }
    );
  });
}

/**
 * Модалка Cropper.js: обрезка фото перед добавлением в список (в т.ч. после «Снять фото»).
 * @returns {Promise<File | null>} null — отмена; File — результат (JPEG после обрезки или исходный)
 */
export function openCropModalForAttachment(file) {
  return new Promise((resolve) => {
    if (typeof window.Cropper === "undefined") {
      resolve(file);
      return;
    }
    const modal = document.getElementById("cropImageModal");
    const img = document.getElementById("cropImageTarget");
    const cancelBtn = document.getElementById("cropCancelBtn");
    const skipBtn = document.getElementById("cropSkipBtn");
    const confirmBtn = document.getElementById("cropConfirmBtn");
    if (!modal || !img || !cancelBtn || !skipBtn || !confirmBtn) {
      resolve(file);
      return;
    }

    let cropper = null;
    let keyHandler = null;
    /** @type {string | null} */
    let objectUrl = null;
    const backdrop = modal.querySelector(".crop-image-modal-backdrop");

    const cleanup = () => {
      if (keyHandler) {
        document.removeEventListener("keydown", keyHandler);
        keyHandler = null;
      }
      if (backdrop) backdrop.onclick = null;
      if (cropper) {
        try {
          cropper.destroy();
        } catch {
          /* ignore */
        }
        cropper = null;
      }
      if (objectUrl) {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {
          /* ignore */
        }
        objectUrl = null;
      }
      img.removeAttribute("src");
      modal.hidden = true;
      modal.style.display = "none";
    };

    const onCancel = () => {
      cleanup();
      resolve(null);
    };

    keyHandler = (e) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", keyHandler);
    if (backdrop) backdrop.onclick = onCancel;

    const onSkip = () => {
      cleanup();
      resolve(file);
    };

    const onConfirm = () => {
      if (!cropper) {
        cleanup();
        resolve(file);
        return;
      }
      let canvas;
      try {
        canvas = cropper.getCroppedCanvas({
          maxWidth: 4096,
          maxHeight: 4096,
          imageSmoothingQuality: "high",
        });
      } catch {
        cleanup();
        resolve(file);
        return;
      }
      if (!canvas) {
        cleanup();
        resolve(file);
        return;
      }
      canvas.toBlob(
        (blob) => {
          cleanup();
          if (!blob) {
            resolve(file);
            return;
          }
          const base = (file.name || "photo").replace(/\.[^.]+$/i, "") || "photo";
          resolve(
            new File([blob], `${base}.jpg`, {
              type: "image/jpeg",
              lastModified: Date.now(),
            })
          );
        },
        "image/jpeg",
        0.92
      );
    };

    cancelBtn.onclick = onCancel;
    skipBtn.onclick = onSkip;
    confirmBtn.onclick = onConfirm;

    const initCropper = () => {
      img.onload = () => {
        if (cropper) {
          try {
            cropper.destroy();
          } catch {
            /* ignore */
          }
          cropper = null;
        }
        cropper = new window.Cropper(img, {
          viewMode: 1,
          dragMode: "move",
          aspectRatio: NaN,
          autoCropArea: 0.92,
          responsive: true,
          background: false,
          movable: true,
          zoomable: true,
          rotatable: false,
          /* Ориентация уже учтена в пикселях (load-image); иначе Cropper + EXIF дают лишний поворот на iPhone */
          checkOrientation: false,
        });
      };

      img.onerror = () => {
        cleanup();
        resolve(file);
      };

      modal.hidden = false;
      modal.style.display = "flex";
      img.src = objectUrl;
    };

    createOrientedImageObjectUrl(file)
      .then((url) => {
        objectUrl = url;
        initCropper();
      })
      .catch(() => {
        objectUrl = URL.createObjectURL(file);
        initCropper();
      });
  });
}

/**
 * Добавить файлы в список к загрузке (обрезка для фото — как при выборе с диска).
 * @param {File[]} picked
 */
async function mergeNewAttachmentFiles(picked) {
  if (!picked.length) return;

  const needsCrop = picked.some((f) => isCroppableImageFile(f));
  if (needsCrop) {
    try {
      await ensureCropperLibs();
    } catch (e) {
      console.warn("Библиотеки обрезки фото:", e);
    }
  }

  for (const file of picked) {
    let toAdd = file;
    if (isCroppableImageFile(file)) {
      try {
        const result = await openCropModalForAttachment(file);
        if (result === null) continue;
        toAdd = result;
      } catch (e) {
        console.warn("Обрезка фото:", e);
        toAdd = file;
      }
    }
    pendingAttachments.push(toAdd);
  }

  applyPendingToAttachmentsInput();
  renderSelectedFiles();
}

/**
 * Обработчик change у input[type=file]: новый выбор добавляется к уже выбранным.
 * Для фото JPEG/PNG/WebP и т.п. открывается обрезка (если подключён Cropper.js).
 */
export async function mergeNewAttachmentsOnChange() {
  if (!attachmentsInput) return;
  const picked = Array.from(attachmentsInput.files || []);
  if (picked.length === 0) return;
  attachmentsInput.value = "";

  await mergeNewAttachmentFiles(picked);
}

/**
 * Вставка первого изображения из буфера обмена в список вложений формы (как после «Загрузить»).
 * @returns {Promise<"ok" | "empty">} empty — в буфере нет изображения или чтение недоступно
 */
export async function pasteImageFromClipboardIntoAttachments() {
  if (typeof navigator.clipboard?.read !== "function") {
    return "empty";
  }
  let items;
  try {
    items = await navigator.clipboard.read();
  } catch (e) {
    console.warn("Чтение буфера обмена:", e);
    return "empty";
  }
  for (const item of items) {
    const types = item.types || [];
    for (const type of types) {
      if (!type.startsWith("image/")) continue;
      let blob;
      try {
        blob = await item.getType(type);
      } catch (e) {
        console.warn("clipboard.getType:", e);
        continue;
      }
      if (!blob || blob.size === 0) continue;
      const subRaw = (type.split("/")[1] || "png").split("+")[0] || "png";
      const sub = /^[a-z0-9]+$/i.test(subRaw) ? subRaw.toLowerCase() : "png";
      const file = new File([blob], `clipboard.${sub}`, {
        type,
        lastModified: Date.now(),
      });
      await mergeNewAttachmentFiles([file]);
      return "ok";
    }
  }
  return "empty";
}

export function renderSelectedFiles() {
  const files = [...pendingAttachments];

  for (const u of selectedPreviewBlobUrls) {
    try {
      URL.revokeObjectURL(u);
    } catch {
      /* ignore */
    }
  }
  selectedPreviewBlobUrls = [];

  selectedFiles.innerHTML = "";

  if (files.length === 0) {
    fileUploadText.textContent = "";
    return;
  }

  fileUploadText.textContent = `Выбрано файлов: ${files.length}`;

  files.forEach((file, index) => {
    const row = document.createElement("div");
    row.className = "preview-item";

    let preview;

    if (file.type.startsWith("image/")) {
      const blobUrl = URL.createObjectURL(file);
      selectedPreviewBlobUrls.push(blobUrl);
      const link = document.createElement("a");
      link.className = "preview-thumb-link";
      link.href = blobUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.title = "Открыть изображение";
      const img = document.createElement("img");
      img.className = "preview-thumb";
      img.src = blobUrl;
      img.alt = file.name || "";
      link.appendChild(img);
      preview = link;
    } else {
      const icon = document.createElement("div");
      icon.className = "preview-icon";
      icon.textContent = "📄";
      preview = icon;
    }

    const name = document.createElement("div");
    name.className = "preview-name";
    name.textContent = file.name;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "preview-remove-btn";
    removeBtn.textContent = "✕";
    removeBtn.title = "Удалить файл";

    removeBtn.addEventListener("click", () => {
      removeSelectedFile(index);
    });

    row.appendChild(preview);
    row.appendChild(name);
    row.appendChild(removeBtn);

    selectedFiles.appendChild(row);
  });
}

export function removeSelectedFile(indexToRemove) {
  if (indexToRemove < 0 || indexToRemove >= pendingAttachments.length) return;
  pendingAttachments.splice(indexToRemove, 1);
  applyPendingToAttachmentsInput();
  renderSelectedFiles();
}

export function resetFileUpload() {
  pendingAttachments.length = 0;
  for (const u of selectedPreviewBlobUrls) {
    try {
      URL.revokeObjectURL(u);
    } catch {
      /* ignore */
    }
  }
  selectedPreviewBlobUrls = [];
  if (attachmentsInput) attachmentsInput.value = "";
  if (fileUploadText) fileUploadText.textContent = "";
  if (clipboardPasteHint) clipboardPasteHint.textContent = "";
  if (selectedFiles) selectedFiles.innerHTML = "";
}

/** Скрыть блок уже загруженных файлов (режим «Новая заявка»). */
export function clearExistingOrderFilesInForm() {
  const wrap = document.getElementById("existingOrderFilesWrap");
  const list = document.getElementById("existingOrderFilesList");
  if (list) list.innerHTML = "";
  if (wrap) wrap.hidden = true;
}

/**
 * Список файлов заказа в форме редактирования: превью + удаление (как в модалке).
 */
export async function renderExistingOrderFilesInForm(orderId) {
  const wrap = document.getElementById("existingOrderFilesWrap");
  const list = document.getElementById("existingOrderFilesList");
  if (!wrap || !list) return;

  if (orderId == null) {
    clearExistingOrderFilesInForm();
    return;
  }

  if (typeof orderId === "number" && orderId < 0) {
    clearExistingOrderFilesInForm();
    return;
  }

  wrap.hidden = false;
  list.innerHTML = '<p class="existing-order-files-loading">Загрузка списка…</p>';

  const files = await loadOrderFiles(orderId);

  list.innerHTML = "";

  if (!files.length) {
    wrap.hidden = true;
    return;
  }

  const onDelete =
    state.viewingOrderId != null && Number(state.viewingOrderId) === Number(orderId)
      ? null
      : removeOrderFileFromEditForm;

  for (const file of files) {
    const row = await createOrderFileRowElement(file, orderId, onDelete);
    list.appendChild(row);
  }
}

/** Целевой размер от исходного (~в ~20 раз меньше для многомегабайтных фото; сильнее чем раньше). */
function targetCompressedBytes(originalSize) {
  if (originalSize >= 2 * 1024 * 1024) return Math.floor(originalSize * 0.055);
  if (originalSize >= 1024 * 1024) return Math.floor(originalSize * 0.065);
  if (originalSize >= 500 * 1024) return Math.floor(originalSize * 0.09);
  return Math.floor(originalSize * 0.14);
}

let _canvasSupportsWebpCached;
function canvasSupportsWebp() {
  if (_canvasSupportsWebpCached !== undefined) return _canvasSupportsWebpCached;
  try {
    const c = document.createElement("canvas");
    c.width = 2;
    c.height = 2;
    _canvasSupportsWebpCached = /^data:image\/webp/i.test(c.toDataURL("image/webp"));
  } catch {
    _canvasSupportsWebpCached = false;
  }
  return _canvasSupportsWebpCached;
}

function scaleToMaxLongEdge(width, height, maxEdge) {
  const m = Math.max(width, height);
  if (m <= maxEdge) return { w: width, h: height };
  const k = maxEdge / m;
  return { w: Math.max(1, Math.round(width * k)), h: Math.max(1, Math.round(height * k)) };
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime, quality);
  });
}

const THUMB_MAX_LONG_EDGE = 280;

/**
 * Миниатюра для списков (редактирование, модалка). Только растр; SVG/GIF — null.
 */
export async function buildThumbnailBlob(imageFile) {
  if (!imageFile?.type?.startsWith("image/")) return null;
  if (imageFile.type === "image/svg+xml" || imageFile.type === "image/gif") return null;

  let bitmap;
  try {
    bitmap = await createImageBitmap(imageFile);
  } catch {
    return null;
  }

  const { w, h } = scaleToMaxLongEdge(bitmap.width, bitmap.height, THUMB_MAX_LONG_EDGE);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return null;
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const mime = canvasSupportsWebp() ? "image/webp" : "image/jpeg";
  const q = mime === "image/webp" ? 0.72 : 0.78;
  return canvasToBlob(canvas, mime, q);
}

/** Подписанные URL: полный файл и превью (если есть в БД). */
async function getSignedUrlsForOrderFileRow(fileRow) {
  const fullPromise = getSignedFileUrl(fileRow.storage_path);
  const thumbPromise = fileRow.thumbnail_storage_path
    ? getSignedFileUrl(fileRow.thumbnail_storage_path)
    : Promise.resolve(null);
  const [fullUrl, thumbUrl] = await Promise.all([fullPromise, thumbPromise]);
  return {
    fullUrl,
    /** Для превью: миниатюра или запасной вариант — полный файл (старые записи). */
    previewUrl: thumbUrl || fullUrl,
  };
}

/** Подбор качества: максимальное q при размере ≤ targetBytes (или ближайшее ниже). */
async function blobAtOrBelowTarget(canvas, mime, targetBytes) {
  let lo = 0.26;
  let hi = 0.88;
  let best = null;
  for (let i = 0; i < 16; i++) {
    const q = (lo + hi) / 2;
    const blob = await canvasToBlob(canvas, mime, q);
    if (!blob) {
      hi = q;
      continue;
    }
    if (blob.size <= targetBytes) {
      best = blob;
      lo = q;
    } else {
      hi = q;
    }
  }
  if (best) return best;
  const fallback = await canvasToBlob(canvas, mime, 0.4);
  return fallback;
}

const COMPRESS_MIN_BYTES = 380 * 1024;
const COMPRESS_MIN_LONG_EDGE = 2100;
const COMPRESS_INITIAL_MAX_EDGE = 1600;

/**
 * Сжимает крупные растровые фото под веб (WebP или JPEG), цель сильного уменьшения (~×20 от исходного для тяжёлых фото).
 * GIF/SVG не трогаем; при ошибке декодирования — исходный файл.
 */
export async function compressImageForWebIfNeeded(file) {
  if (!file?.type?.startsWith("image/")) return file;
  if (file.type === "image/svg+xml" || file.type === "image/gif") return file;

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (e) {
    console.warn("Не удалось декодировать изображение, грузим как есть:", file.name, e);
    return file;
  }

  const iw = bitmap.width;
  const ih = bitmap.height;
  const longEdge = Math.max(iw, ih);
  const worthCompressing =
    file.size >= COMPRESS_MIN_BYTES || longEdge >= COMPRESS_MIN_LONG_EDGE;
  if (!worthCompressing) {
    bitmap.close();
    return file;
  }

  const targetBytes = targetCompressedBytes(file.size);
  const outMime = canvasSupportsWebp() ? "image/webp" : "image/jpeg";

  let maxEdge = COMPRESS_INITIAL_MAX_EDGE;
  let bestBlob = null;
  let bestSize = Infinity;

  for (let attempt = 0; attempt < 5; attempt++) {
    const { w, h } = scaleToMaxLongEdge(iw, ih, maxEdge);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);

    const blob = await blobAtOrBelowTarget(canvas, outMime, targetBytes);
    if (blob && blob.size < file.size && blob.size < bestSize) {
      bestBlob = blob;
      bestSize = blob.size;
      if (blob.size <= targetBytes * 1.2) break;
    }
    maxEdge = Math.round(maxEdge * 0.7);
    if (maxEdge < 600) break;
  }

  bitmap.close();

  if (!bestBlob || bestBlob.size >= file.size) return file;

  const base = (file.name || "image").replace(/\.[^./\\]+$/i, "") || "image";
  const ext = outMime === "image/webp" ? ".webp" : ".jpg";
  return new File([bestBlob], `${base}${ext}`, {
    type: outMime,
    lastModified: Date.now(),
  });
}

/**
 * Safari/iOS: supabase-js отдаёт тело запроса как ReadableStream; WebKit отвечает
 * «ReadableStream uploading is not supported». Собираем обычный Blob из буфера.
 */
export async function blobBodyForStorageUpload(blob) {
  const buf = await blob.arrayBuffer();
  return new Blob([buf], { type: blob.type || "application/octet-stream" });
}

async function writeFileChangeToHistory(orderId, comment) {
  if (!orderId || !comment) return;
  const userEmail = state.currentUser?.email;
  if (!userEmail) return;
  const { error } = await supabaseClient.from("order_history").insert([
    { order_id: orderId, user_email: userEmail, comment },
  ]);
  if (error) {
    console.error("Ошибка записи изменения файлов в историю:", error);
  }
}

export async function uploadFiles(orderId) {
  applyPendingToAttachmentsInput();
  if (pendingAttachments.length === 0) {
    resetFileUpload();
    return;
  }

  const files = [...pendingAttachments];
  let uploadedFilesCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fileToUpload = await compressImageForWebIfNeeded(file);
    const rawName = (fileToUpload.name || "").trim() || "file";
    const safeName = rawName.replace(/[^\w.\-]+/g, "_").replace(/^\.+$/, "") || "file";
    /* iPhone часто даёт нескольким снимкам одно имя (image.jpg); Date.now() в одной миллисекунде совпадает — путь должен быть уникален. */
    const stamp = `${Date.now()}_${i}_${Math.random().toString(36).slice(2, 10)}`;
    const filePath = `${state.currentUser.id}/${orderId}/${stamp}_${safeName}`;

    const uploadBody = await blobBodyForStorageUpload(fileToUpload);
    const { error: uploadError } = await supabaseClient.storage
      .from("order-files")
      .upload(filePath, uploadBody, {
        cacheControl: "3600",
        upsert: false,
        contentType: fileToUpload.type || "application/octet-stream",
      });

    if (uploadError) {
      console.error("Ошибка загрузки файла:", uploadError);
      const hint = uploadError.message ? ` (${uploadError.message})` : "";
      setMessage(`Ошибка загрузки файла: ${file.name || rawName}${hint}`, "#d32f2f");
      continue;
    }

    let thumbnailStoragePath = null;
    const isRasterImage =
      fileToUpload.type.startsWith("image/") &&
      fileToUpload.type !== "image/svg+xml" &&
      fileToUpload.type !== "image/gif";

    if (isRasterImage) {
      const thumbBlob = await buildThumbnailBlob(fileToUpload);
      if (thumbBlob && thumbBlob.size > 0) {
        const thumbExt = thumbBlob.type === "image/jpeg" ? "jpg" : "webp";
        thumbnailStoragePath = `${state.currentUser.id}/${orderId}/${stamp}_thumb.${thumbExt}`;
        const thumbUploadBody = await blobBodyForStorageUpload(thumbBlob);
        const { error: thumbErr } = await supabaseClient.storage.from("order-files").upload(thumbnailStoragePath, thumbUploadBody, {
          cacheControl: "86400",
          upsert: false,
          contentType: thumbBlob.type || "image/webp",
        });
        if (thumbErr) {
          console.warn("Миниатюра не загружена, превью будет из полного файла:", thumbErr);
          thumbnailStoragePath = null;
        }
      }
    }

    const { error: dbError } = await supabaseClient
      .from("order_files")
      .insert([
        {
          order_id: orderId,
          file_name: file.name,
          storage_path: filePath,
          thumbnail_storage_path: thumbnailStoragePath,
          mime_type: fileToUpload.type || null,
          file_size: fileToUpload.size ?? null,
          uploaded_by: state.currentUser.id,
        },
      ]);

    if (dbError) {
      console.error("Ошибка записи файла в БД:", dbError);
      setMessage(`Файл загружен, но не записан в БД: ${file.name}`, "#d32f2f");
      if (thumbnailStoragePath) {
        await supabaseClient.storage.from("order-files").remove([thumbnailStoragePath]).catch(() => {});
      }
      await supabaseClient.storage.from("order-files").remove([filePath]).catch(() => {});
    } else {
      uploadedFilesCount += 1;
    }
  }

  if (uploadedFilesCount > 0) {
    await writeFileChangeToHistory(orderId, `добавлен файл (${uploadedFilesCount} шт.)`);
  }

  resetFileUpload();
}

export async function loadFilesCountMap() {
  const { data, error } = await supabaseClient
    .from("order_files")
    .select("order_id");

  if (error) {
    console.error("Ошибка загрузки количества файлов:", error);
    state.filesCountMap = {};
    return;
  }

  const map = {};

  (data || []).forEach((file) => {
    map[file.order_id] = (map[file.order_id] || 0) + 1;
  });

  state.filesCountMap = map;
}

export function getFilesWord(count) {
  if (count % 10 === 1 && count % 100 !== 11) return "";
  if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) {
    return "а";
  }
  return "ов";
}

export async function loadOrderFiles(orderId) {
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

export async function getSignedFileUrl(storagePath) {
  const { data, error } = await supabaseClient.storage
    .from("order-files")
    .createSignedUrl(storagePath, 60 * 10);

  if (error) {
    console.error("Ошибка получения ссылки:", error);
    return null;
  }

  return data?.signedUrl || null;
}

export function isImageFile(file) {
  return (file.mime_type || "").startsWith("image/");
}

export function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return "-";
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

/** До maxLen символов; при обрезке — «…» в конце (полное имя в title). */
function truncateFileNameForModal(name, maxLen = 20) {
  if (name == null || name === "") return "Файл";
  const s = String(name);
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1)}…`;
}

function appendDownloadIconToButton(btn) {
  const svgDl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svgDl.setAttribute("width", "16");
  svgDl.setAttribute("height", "16");
  svgDl.setAttribute("viewBox", "0 0 24 24");
  svgDl.setAttribute("fill", "none");
  svgDl.setAttribute("stroke", "currentColor");
  svgDl.setAttribute("stroke-width", "2");
  svgDl.setAttribute("stroke-linecap", "round");
  svgDl.setAttribute("stroke-linejoin", "round");
  svgDl.setAttribute("aria-hidden", "true");
  const pathDl = document.createElementNS("http://www.w3.org/2000/svg", "path");
  pathDl.setAttribute("d", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4");
  const polyDl = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyDl.setAttribute("points", "7 10 12 15 17 10");
  const lineDl = document.createElementNS("http://www.w3.org/2000/svg", "line");
  lineDl.setAttribute("x1", "12");
  lineDl.setAttribute("y1", "15");
  lineDl.setAttribute("x2", "12");
  lineDl.setAttribute("y2", "3");
  svgDl.appendChild(pathDl);
  svgDl.appendChild(polyDl);
  svgDl.appendChild(lineDl);
  btn.appendChild(svgDl);
}

function appendRemoveIconToButton(delBtn) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("aria-hidden", "true");
  const line1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line1.setAttribute("x1", "18");
  line1.setAttribute("y1", "6");
  line1.setAttribute("x2", "6");
  line1.setAttribute("y2", "18");
  const line2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line2.setAttribute("x1", "6");
  line2.setAttribute("y1", "6");
  line2.setAttribute("x2", "18");
  line2.setAttribute("y2", "18");
  svg.appendChild(line1);
  svg.appendChild(line2);
  delBtn.appendChild(svg);
}

function canDeleteOrderFile(file) {
  if (isAdmin()) return true;
  if (!isUserLite()) return false;
  const currentUserId = state.currentUser?.id;
  if (!currentUserId) return false;
  return String(file?.uploaded_by || "") === String(currentUserId);
}

function runAttachmentAction(el, action) {
  el.addEventListener("click", () => {
    if (el.dataset.loading === "1") return;
    el.dataset.loading = "1";
    const prevLabel = el.textContent;
    if (prevLabel) el.textContent = "Загрузка…";
    el.setAttribute("aria-busy", "true");
    if ("disabled" in el) el.disabled = true;

    void action()
      .catch((e) => {
        console.error("Вложение:", e);
        setMessage(e?.message || "Не удалось открыть файл", "#d32f2f");
      })
      .finally(() => {
        delete el.dataset.loading;
        if (prevLabel) el.textContent = prevLabel;
        el.removeAttribute("aria-busy");
        if ("disabled" in el) el.disabled = false;
      });
  });
}

/**
 * Строка файла: как в модалке (превью, имя, мета, Открыть / Скачать / Удалить по правам роли).
 * @param {(fileId: number, orderId: number) => void | Promise<void>} onAdminDelete
 */
async function createOrderFileRowElement(file, orderId, onAdminDelete, { largePreview = false } = {}) {
  const { fullUrl, previewUrl } = await getSignedUrlsForOrderFileRow(file);
  const isImage = isImageFile(file);
  const imageSrc = largePreview ? fullUrl || previewUrl : previewUrl;

  const row = document.createElement("div");
  row.className = "file-row";

  const preview = document.createElement("div");
  preview.className = "file-preview";

  if (isImage && imageSrc) {
    const link = document.createElement("a");
    link.href = fullUrl || previewUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.title = "Открыть полное изображение";
    const img = document.createElement("img");
    img.className = "file-thumb";
    img.src = imageSrc;
    img.alt = file.file_name || "";
    img.loading = "lazy";
    img.decoding = "async";
    link.appendChild(img);
    preview.appendChild(link);
  } else {
    const icon = document.createElement("div");
    icon.className = "file-icon";
    icon.textContent = "📄";
    preview.appendChild(icon);
  }

  const body = document.createElement("div");
  body.className = "file-row-body";

  const nameEl = document.createElement("div");
  nameEl.className = "file-name-trunc";
  const fullName = file.file_name || "Файл";
  nameEl.textContent = truncateFileNameForModal(fullName, 20);
  if (fullName.length > 20) nameEl.title = fullName;

  const metaEl = document.createElement("div");
  metaEl.className = "file-meta-line";
  metaEl.textContent = `${file.mime_type || "неизвестный тип"} | ${formatFileSize(file.file_size)}`;

  const actions = document.createElement("div");
  actions.className = "file-actions";

  if (fullUrl) {
    const spreadsheet = isSpreadsheetAttachment(fullName, file.mime_type);
    const useIosBlob =
      isIosDevice() && needsIosBlobDelivery(fullName, file.mime_type);
    const openInApp = spreadsheet || useIosBlob;

    const openEl = document.createElement(openInApp ? "button" : "a");
    openEl.className = "file-action-btn";
    openEl.textContent = "Открыть";
    if (spreadsheet) {
      // Не уводим в Safari-заглушку «Таблица Office Open XML» — сразу сетка.
      openEl.type = "button";
      runAttachmentAction(openEl, () => openSpreadsheetViewer(fullUrl, fullName));
    } else if (useIosBlob) {
      openEl.type = "button";
      runAttachmentAction(openEl, () =>
        openAttachmentOnIos(fullUrl, fullName, file.mime_type),
      );
    } else {
      openEl.href = fullUrl;
      openEl.target = "_blank";
      openEl.rel = "noopener noreferrer";
    }
    actions.appendChild(openEl);

    const dlEl = document.createElement(useIosBlob ? "button" : "a");
    dlEl.className = "file-download-btn";
    dlEl.title = "Скачать";
    dlEl.setAttribute("aria-label", "Скачать файл");
    if (useIosBlob) {
      dlEl.type = "button";
      runAttachmentAction(dlEl, () => downloadAttachmentOnIos(fullUrl, fullName));
    } else {
      dlEl.href = fullUrl;
      dlEl.download = fullName;
    }
    appendDownloadIconToButton(dlEl);
    actions.appendChild(dlEl);
  }

  if (canDeleteOrderFile(file) && onAdminDelete) {
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "file-remove-btn";
    delBtn.title = "Удалить";
    delBtn.setAttribute("aria-label", "Удалить файл");
    appendRemoveIconToButton(delBtn);
    const fid = file.id;
    const oid = orderId;
    delBtn.addEventListener("click", () => {
      void onAdminDelete(fid, oid);
    });
    actions.appendChild(delBtn);
  }

  body.appendChild(nameEl);
  body.appendChild(metaEl);
  body.appendChild(actions);

  row.appendChild(preview);
  row.appendChild(body);

  return row;
}

export async function openFilesModal(orderId) {
  const order = state.allOrders.find((o) => Number(o.id) === Number(orderId));
  if (order != null && isOrderHiddenForCurrentRole(order)) {
    setMessage("Нет доступа к этому типу заказа", "#d32f2f");
    return;
  }
  const chip = formatOrderIdTypeChip(
    order != null ? order.id : orderId,
    order != null ? order.order_type : ""
  );
  filesModalTitle.textContent = `Заказ ${chip}`;
  filesModalBody.textContent = "";
  const loading = document.createElement("p");
  loading.className = "files-modal-loading";
  loading.textContent = "Загрузка...";
  filesModalBody.appendChild(loading);
  filesModal.style.display = "flex";

  const files = await loadOrderFiles(orderId);

  filesModalBody.textContent = "";

  if (!files.length) {
    const empty = document.createElement("p");
    empty.textContent = "У этого заказа пока нет файлов.";
    filesModalBody.appendChild(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "files-list";

  for (const file of files) {
    const row = await createOrderFileRowElement(file, orderId, removeFile, { largePreview: true });
    list.appendChild(row);
  }

  filesModalBody.appendChild(list);
}

/** Удаление из Storage (полный + миниатюра) и из таблицы order_files. */
async function deleteOrderFileFromStorageAndDb(fileId) {
  const { data: row, error: fetchError } = await supabaseClient
    .from("order_files")
    .select("storage_path, thumbnail_storage_path, uploaded_by")
    .eq("id", fileId)
    .maybeSingle();

  if (fetchError) {
    console.error("Ошибка чтения файла:", fetchError);
    return { ok: false, message: "Не удалось найти файл" };
  }
  if (!row?.storage_path) {
    return { ok: false, message: "Запись файла не найдена" };
  }
  if (!canDeleteOrderFile(row)) {
    return { ok: false, message: "Нет прав на удаление этого файла" };
  }

  const paths = [row.storage_path];
  if (row.thumbnail_storage_path) paths.push(row.thumbnail_storage_path);

  const { error: storageError } = await supabaseClient.storage.from("order-files").remove(paths);

  if (storageError) {
    console.error("Ошибка удаления файла из Storage:", storageError);
    return { ok: false, message: "Ошибка удаления файла" };
  }

  const { error: dbError } = await supabaseClient.from("order_files").delete().eq("id", fileId);

  if (dbError) {
    console.error("Ошибка удаления записи файла:", dbError);
    return { ok: false, message: "Файл удалён из Storage, но не удалён из БД" };
  }

  return { ok: true };
}

export async function removeFile(fileId, orderId) {
  const ok = confirm("Удалить файл?");
  if (!ok) return;

  const result = await deleteOrderFileFromStorageAndDb(fileId);
  if (!result.ok) {
    setMessage(result.message, "#d32f2f");
    return;
  }

  setMessage("Файл удалён");
  await writeFileChangeToHistory(orderId, "удален файл (1 шт.)");
  await loadFilesCountMap();

  const { applyClientFilter } = await import("./orders.js");
  applyClientFilter();

  await openFilesModal(orderId);
}

/** Удаление из формы редактирования заявки (блок «Фото и документы»). */
export async function removeOrderFileFromEditForm(fileId, orderId) {
  const ok = confirm("Удалить файл?");
  if (!ok) return;

  const result = await deleteOrderFileFromStorageAndDb(fileId);
  if (!result.ok) {
    setMessage(result.message, "#d32f2f");
    return;
  }

  setMessage("Файл удалён");
  await writeFileChangeToHistory(orderId, "удален файл (1 шт.)");
  await loadFilesCountMap();

  const { applyClientFilter } = await import("./orders.js");
  applyClientFilter();

  if (state.editingOrderId === orderId || state.viewingOrderId === orderId) {
    await renderExistingOrderFilesInForm(orderId);
  }
}