/**
 * Открытие/скачивание вложений на iPhone (особенно PWA).
 *
 * Прямая ссылка target="_blank" на xlsx в standalone PWA часто даёт белый экран.
 * Свой HTML-«интерпретатор» таблицы не используем — нужен системный просмотр iOS
 * (как «Просмотреть» у файла в Загрузках / Файлах = Quick Look).
 *
 * «Открыть»: URL с ?download=имя (Content-Disposition: attachment) или blob с
 * настоящим MIME Excel — iOS показывает системный просмотр, а не Share «выберите программу».
 * «Скачать»: отдельный путь через octet-stream.
 */

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

function ensureFileName(fileName, mimeType) {
  const name = (fileName || "").trim() || "file";
  if (/\.[a-z0-9]{1,8}$/i.test(name)) return name;
  const mime = (mimeType || "").toLowerCase();
  if (mime.includes("spreadsheetml") || mime.includes("excel")) return `${name}.xlsx`;
  if (mime.includes("csv")) return `${name}.csv`;
  if (mime.includes("wordprocessing") || mime === "application/msword") return `${name}.docx`;
  if (mime.includes("presentation")) return `${name}.pptx`;
  return name;
}

async function fetchArrayBuffer(url) {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) {
    throw new Error(`Не удалось загрузить файл (HTTP ${res.status})`);
  }
  return res.arrayBuffer();
}

function clickAnchor(href, { downloadName, newTab } = {}) {
  const a = document.createElement("a");
  a.href = href;
  a.rel = "noopener noreferrer";
  a.style.display = "none";
  if (downloadName) {
    a.download = downloadName;
    a.setAttribute("download", downloadName);
  }
  if (newTab) a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Supabase: ?download=filename → Content-Disposition: attachment (вне подписи токена). */
function withDownloadQuery(url, fileName) {
  const u = new URL(url);
  u.searchParams.set("download", fileName);
  return u.toString();
}

/**
 * «Открыть» на iOS: системный просмотр документа (Quick Look / «Просмотреть»),
 * без Share sheet и без своего HTML-рендера таблицы.
 *
 * @param {string} url подписанный URL
 * @param {string} fileName
 * @param {string | null | undefined} mimeType
 */
export async function openAttachmentOnIos(url, fileName, mimeType) {
  const name = ensureFileName(fileName, mimeType);
  const mime = mimeType || guessMimeFromName(name);

  // 1) Blob с реальным MIME Excel (не octet-stream) + download.
  //    На iOS это обычно открывает системный просмотр документа одним жестом
  //    (тот же Quick Look, что «Просмотреть» / открытие из «Файлы»).
  //    Share sheet намеренно не вызываем — там нет Quick Look, только «программы».
  const buf = await fetchArrayBuffer(url);
  const blob = new Blob([buf], { type: mime });
  const blobUrl = URL.createObjectURL(blob);
  try {
    clickAnchor(blobUrl, { downloadName: name });
  } catch (e) {
    console.warn("iOS open via blob:", e);
    URL.revokeObjectURL(blobUrl);
    // 2) Запасной путь: HTTPS + ?download=имя → системный диалог с «Просмотреть».
    const viewUrl = withDownloadQuery(url, name);
    clickAnchor(viewUrl, { newTab: true });
    return;
  }
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 180_000);
}

/**
 * Скачивание через blob (download на cross-origin в iOS не работает).
 * @param {string} url
 * @param {string} fileName
 */
export async function downloadAttachmentOnIos(url, fileName) {
  const name = fileName || "file";
  const buf = await fetchArrayBuffer(url);
  const blob = new Blob([buf], { type: "application/octet-stream" });
  const blobUrl = URL.createObjectURL(blob);
  try {
    clickAnchor(blobUrl, { downloadName: name });
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 180_000);
  }
}
