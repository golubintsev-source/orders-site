/**
 * Открытие/скачивание вложений на iPhone (особенно PWA).
 *
 * Прямая ссылка / blob-download на xlsx в Safari/PWA даёт заглушку
 * «Таблица Office Open XML» без самой таблицы — дальше открыть нельзя.
 * Для Excel/CSV открываем сетку в приложении (SheetJS). Остальные office-файлы —
 * через Share или download.
 */

import {
  isSpreadsheetAttachment,
  openSpreadsheetViewer,
} from "./spreadsheetViewer.js";

export function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent || "");
}

const INLINE_RISKY_EXT = /\.(xlsx?|docx?|pptx?|csv|ods|odt)$/i;
const INLINE_RISKY_MIME =
  /spreadsheet|excel|msword|wordprocessing|presentation|powerpoint|officedocument/i;

/** Файлы, которые Safari на iOS не умеет показывать inline (зависание на белом экране). */
export function needsIosBlobDelivery(fileName, mimeType) {
  if (INLINE_RISKY_EXT.test(fileName || "")) return true;
  if (INLINE_RISKY_MIME.test(mimeType || "")) return true;
  return false;
}

export { isSpreadsheetAttachment };

function guessMimeFromName(fileName) {
  const n = (fileName || "").toLowerCase();
  if (n.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (n.endsWith(".xls")) return "application/vnd.ms-excel";
  if (n.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (n.endsWith(".doc")) return "application/msword";
  if (n.endsWith(".pptx")) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (n.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
  if (n.endsWith(".csv")) return "text/csv";
  return "application/octet-stream";
}

async function fetchAsOctetBlob(url) {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) {
    throw new Error(`Не удалось загрузить файл (HTTP ${res.status})`);
  }
  const buf = await res.arrayBuffer();
  return new Blob([buf], { type: "application/octet-stream" });
}

/**
 * «Открыть» на iOS: Excel/CSV — таблица в приложении; иначе Share / blob.
 * @param {string} url подписанный URL
 * @param {string} fileName
 * @param {string | null | undefined} mimeType
 */
export async function openAttachmentOnIos(url, fileName, mimeType) {
  const name = fileName || "file";

  if (isSpreadsheetAttachment(name, mimeType)) {
    await openSpreadsheetViewer(url, name);
    return;
  }

  const blob = await fetchAsOctetBlob(url);
  const shareMime = mimeType || guessMimeFromName(name);
  const file = new File([blob], name, { type: shareMime });

  if (typeof navigator.share === "function" && typeof navigator.canShare === "function") {
    try {
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
    } catch (e) {
      if (e?.name === "AbortError") return;
      console.warn("navigator.share:", e);
    }
  }

  const blobUrl = URL.createObjectURL(blob);
  try {
    window.location.assign(blobUrl);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 120_000);
  }
}

/**
 * Скачивание через blob (download на cross-origin в iOS не работает).
 * @param {string} url
 * @param {string} fileName
 */
export async function downloadAttachmentOnIos(url, fileName) {
  const name = fileName || "file";
  const blob = await fetchAsOctetBlob(url);
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = name;
  a.setAttribute("download", name);
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 120_000);
}
