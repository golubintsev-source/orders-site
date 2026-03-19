import { supabaseClient } from "./config.js";
import { state } from "./state.js";
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

export async function uploadFiles(orderId) {
  const files = attachmentsInput?.files;

  if (!files || files.length === 0) {
    resetFileUpload();
    return;
  }

  for (const file of files) {
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const filePath = `${state.currentUser.id}/${orderId}/${Date.now()}_${safeName}`;

    const { error: uploadError } = await supabaseClient.storage
      .from("order-files")
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || "application/octet-stream",
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
          mime_type: file.type || null,
          file_size: file.size || null,
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

export async function openFilesModal(orderId) {
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
          ${signedUrl ? `<a href="${signedUrl}" target="_blank">Открыть</a>` : ""}
          ${signedUrl ? `<a href="${signedUrl}" download="${file.file_name}">Скачать</a>` : ""}
          ${
            state.currentRole === "admin"
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

export async function removeFile(fileId, storagePath, orderId) {
  const ok = confirm("Удалить файл?");
  if (!ok) return;

  const { error: storageError } = await supabaseClient.storage
    .from("order-files")
    .remove([storagePath]);

  if (storageError) {
    console.error("Ошибка удаления файла из Storage:", storageError);
    setMessage("Ошибка удаления файла", "#d32f2f");
    return;
  }

  const { error: dbError } = await supabaseClient
    .from("order_files")
    .delete()
    .eq("id", fileId);

  if (dbError) {
    console.error("Ошибка удаления записи файла:", dbError);
    setMessage("Файл удалён из Storage, но не удалён из БД", "#d32f2f");
    return;
  }

  setMessage("Файл удалён");
  await loadFilesCountMap();

  const { applyClientFilter } = await import("./orders.js");
  applyClientFilter();

  await openFilesModal(orderId);
}