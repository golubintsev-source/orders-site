import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import { formatOrderIdTypeChip } from "./format.js";
import {
  attachmentsInput,
  fileUploadText,
  selectedFiles,
  filesModal,
  filesModalBody,
  filesModalTitle,
  setMessage,
} from "./dom.js";

export function renderSelectedFiles() {
  const files = Array.from(attachmentsInput.files || []);

  selectedFiles.innerHTML = "";

  if (files.length === 0) {
    fileUploadText.textContent = "Файлы не выбраны";
    return;
  }

  fileUploadText.textContent = `Выбрано файлов: ${files.length}`;

  files.forEach((file, index) => {
    const row = document.createElement("div");
    row.className = "preview-item";

    let preview;

    if (file.type.startsWith("image/")) {
      const img = document.createElement("img");
      img.className = "preview-thumb";
      img.src = URL.createObjectURL(file);
      img.onload = () => URL.revokeObjectURL(img.src);
      preview = img;
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
  const currentFiles = Array.from(attachmentsInput.files || []);
  const dt = new DataTransfer();

  currentFiles.forEach((file, index) => {
    if (index !== indexToRemove) {
      dt.items.add(file);
    }
  });

  attachmentsInput.files = dt.files;
  renderSelectedFiles();
}

export function resetFileUpload() {
  attachmentsInput.value = "";
  fileUploadText.textContent = "Файлы не выбраны";
  selectedFiles.innerHTML = "";
}

/** Скрыть блок уже прикреплённых файлов (режим «Новая заявка»). */
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

  wrap.hidden = false;
  list.innerHTML = '<p class="existing-order-files-loading">Загрузка списка…</p>';

  const files = await loadOrderFiles(orderId);

  list.innerHTML = "";

  if (!files.length) {
    wrap.hidden = true;
    return;
  }

  for (const file of files) {
    const signedUrl = await getSignedFileUrl(file.storage_path);
    const isImage = isImageFile(file);

    const row = document.createElement("div");
    row.className = "preview-item existing-order-file-item";

    let preview;
    if (isImage && signedUrl) {
      const link = document.createElement("a");
      link.href = signedUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const img = document.createElement("img");
      img.className = "preview-thumb";
      img.src = signedUrl;
      img.alt = file.file_name || "";
      link.appendChild(img);
      preview = link;
    } else {
      const icon = document.createElement("div");
      icon.className = "preview-icon";
      icon.textContent = "📄";
      preview = icon;
    }

    const info = document.createElement("div");
    info.className = "preview-info";

    const name = document.createElement("div");
    name.className = "preview-name";
    name.textContent = file.file_name || "Файл";

    const meta = document.createElement("div");
    meta.className = "preview-meta";
    meta.textContent = [file.mime_type || "тип не указан", formatFileSize(file.file_size)].filter(Boolean).join(" · ");

    info.appendChild(name);
    info.appendChild(meta);

    row.appendChild(preview);
    row.appendChild(info);

    if (state.currentRole === "admin") {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "preview-remove-btn";
      removeBtn.textContent = "✕";
      removeBtn.title = "Удалить файл";
      const fid = file.id;
      const path = file.storage_path;
      const oid = orderId;
      removeBtn.addEventListener("click", () => {
        void removeOrderFileFromEditForm(fid, path, oid);
      });
      row.appendChild(removeBtn);
    }

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
async function compressImageForWebIfNeeded(file) {
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

export async function uploadFiles(orderId) {
  const files = attachmentsInput?.files;

  if (!files || files.length === 0) {
    resetFileUpload();
    return;
  }

  for (const file of files) {
    const fileToUpload = await compressImageForWebIfNeeded(file);
    const safeName = fileToUpload.name.replace(/[^\w.\-]+/g, "_");
    const filePath = `${state.currentUser.id}/${orderId}/${Date.now()}_${safeName}`;

    const { error: uploadError } = await supabaseClient.storage
      .from("order-files")
      .upload(filePath, fileToUpload, {
        cacheControl: "3600",
        upsert: false,
        contentType: fileToUpload.type || "application/octet-stream",
      });

    if (uploadError) {
      console.error("Ошибка загрузки файла:", uploadError);
      setMessage(`Ошибка загрузки файла: ${file.name}`, "#d32f2f");
      continue;
    }

    const { error: dbError } = await supabaseClient
      .from("order_files")
      .insert([
        {
          order_id: orderId,
          file_name: file.name,
          storage_path: filePath,
          mime_type: fileToUpload.type || null,
          file_size: fileToUpload.size ?? null,
          uploaded_by: state.currentUser.id,
        },
      ]);

    if (dbError) {
      console.error("Ошибка записи файла в БД:", dbError);
      setMessage(`Файл загружен, но не записан в БД: ${file.name}`, "#d32f2f");
    }
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

export async function openFilesModal(orderId) {
  const order = state.allOrders.find((o) => Number(o.id) === Number(orderId));
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
    const signedUrl = await getSignedFileUrl(file.storage_path);
    const isImage = isImageFile(file);

    const row = document.createElement("div");
    row.className = "file-row";

    const preview = document.createElement("div");
    preview.className = "file-preview";

    if (isImage && signedUrl) {
      const link = document.createElement("a");
      link.href = signedUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const img = document.createElement("img");
      img.className = "file-thumb";
      img.src = signedUrl;
      img.alt = file.file_name || "";
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

    if (signedUrl) {
      const openA = document.createElement("a");
      openA.href = signedUrl;
      openA.target = "_blank";
      openA.rel = "noopener noreferrer";
      openA.className = "file-action-btn";
      openA.textContent = "Открыть";
      actions.appendChild(openA);

      const dlA = document.createElement("a");
      dlA.href = signedUrl;
      dlA.download = file.file_name || "file";
      dlA.className = "file-download-btn";
      dlA.title = "Скачать";
      dlA.setAttribute("aria-label", "Скачать файл");
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
      dlA.appendChild(svgDl);
      actions.appendChild(dlA);
    }

    if (state.currentRole === "admin") {
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "file-remove-btn";
      delBtn.title = "Удалить";
      delBtn.setAttribute("aria-label", "Удалить файл");
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
      const fid = file.id;
      const path = file.storage_path;
      const oid = orderId;
      delBtn.addEventListener("click", () => {
        void removeFile(fid, path, oid);
      });
      actions.appendChild(delBtn);
    }

    body.appendChild(nameEl);
    body.appendChild(metaEl);
    body.appendChild(actions);

    row.appendChild(preview);
    row.appendChild(body);
    list.appendChild(row);
  }

  filesModalBody.appendChild(list);
}

/** Удаление из Storage и из таблицы order_files. */
async function deleteOrderFileFromStorageAndDb(fileId, storagePath) {
  const { error: storageError } = await supabaseClient.storage.from("order-files").remove([storagePath]);

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

export async function removeFile(fileId, storagePath, orderId) {
  const ok = confirm("Удалить файл?");
  if (!ok) return;

  const result = await deleteOrderFileFromStorageAndDb(fileId, storagePath);
  if (!result.ok) {
    setMessage(result.message, "#d32f2f");
    return;
  }

  setMessage("Файл удалён");
  await loadFilesCountMap();

  const { applyClientFilter } = await import("./orders.js");
  applyClientFilter();

  await openFilesModal(orderId);
}

/** Удаление из формы редактирования заявки (блок «Фото и документы»). */
export async function removeOrderFileFromEditForm(fileId, storagePath, orderId) {
  const ok = confirm("Удалить файл?");
  if (!ok) return;

  const result = await deleteOrderFileFromStorageAndDb(fileId, storagePath);
  if (!result.ok) {
    setMessage(result.message, "#d32f2f");
    return;
  }

  setMessage("Файл удалён");
  await loadFilesCountMap();

  const { applyClientFilter } = await import("./orders.js");
  applyClientFilter();

  if (state.editingOrderId === orderId) {
    await renderExistingOrderFilesInForm(orderId);
  }
}