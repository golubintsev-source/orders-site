/**
 * Просмотр Excel/CSV в приложении одним нажатием «Открыть».
 *
 * На iPhone PWA/Safari нельзя вызвать Quick Look из «Файлы»: открытие .xlsx
 * через blob/download даёт заглушку «Таблица Office Open XML» без таблицы
 * и без нормального продолжения. Поэтому для spreadsheet показываем сетку сами
 * (SheetJS) — сразу видно содержимое, как при просмотре таблицы.
 */

import { ensureXlsx } from "./lazy-cdn.js";

const SPREADSHEET_EXT = /\.(xlsx?|csv)$/i;
const SPREADSHEET_MIME = /spreadsheetml|\bexcel\b|text\/csv|\bcsv\b/i;

const MAX_ROWS = 1000;
const MAX_COLS = 60;

let modalEl = null;
let titleEl = null;
let tabsEl = null;
let statusEl = null;
let tableWrapEl = null;
let workbookCache = null;
let fileNameCache = "";
let activeSheetIndex = 0;

export function isSpreadsheetAttachment(fileName, mimeType) {
  if (SPREADSHEET_EXT.test(fileName || "")) return true;
  if (SPREADSHEET_MIME.test(mimeType || "")) return true;
  return false;
}

function ensureModal() {
  if (modalEl) return;

  modalEl = document.createElement("div");
  modalEl.id = "spreadsheetViewerModal";
  modalEl.className = "spreadsheet-viewer-modal";
  modalEl.style.display = "none";
  modalEl.setAttribute("role", "dialog");
  modalEl.setAttribute("aria-modal", "true");
  modalEl.setAttribute("aria-labelledby", "spreadsheetViewerTitle");

  const panel = document.createElement("div");
  panel.className = "spreadsheet-viewer-panel";

  const header = document.createElement("div");
  header.className = "spreadsheet-viewer-header";

  titleEl = document.createElement("h3");
  titleEl.id = "spreadsheetViewerTitle";
  titleEl.className = "spreadsheet-viewer-title";
  titleEl.textContent = "Таблица";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "spreadsheet-viewer-close";
  closeBtn.setAttribute("aria-label", "Закрыть");
  closeBtn.title = "Закрыть";
  closeBtn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  closeBtn.addEventListener("click", closeSpreadsheetViewer);

  header.appendChild(titleEl);
  header.appendChild(closeBtn);

  tabsEl = document.createElement("div");
  tabsEl.className = "spreadsheet-viewer-tabs";
  tabsEl.hidden = true;

  statusEl = document.createElement("p");
  statusEl.className = "spreadsheet-viewer-status";
  statusEl.hidden = true;

  tableWrapEl = document.createElement("div");
  tableWrapEl.className = "spreadsheet-viewer-table-wrap";

  panel.appendChild(header);
  panel.appendChild(tabsEl);
  panel.appendChild(statusEl);
  panel.appendChild(tableWrapEl);
  modalEl.appendChild(panel);

  modalEl.addEventListener("click", (e) => {
    if (e.target === modalEl) closeSpreadsheetViewer();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalEl?.style.display !== "none") {
      closeSpreadsheetViewer();
    }
  });

  document.body.appendChild(modalEl);
}

function cellText(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date) {
    try {
      return value.toLocaleString("ru-RU");
    } catch {
      return String(value);
    }
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return String(value);
}

function colMinWidthPx(rows, colIndex) {
  let maxLen = 0;
  for (const row of rows) {
    const t = cellText(Array.isArray(row) ? row[colIndex] : "");
    if (t.length > maxLen) maxLen = t.length;
  }
  // ~8px на символ, в разумных пределах — без обрезки «…»
  return Math.min(420, Math.max(56, maxLen * 8 + 16));
}

function renderSheet(sheetIndex) {
  if (!workbookCache || !tableWrapEl) return;
  const names = workbookCache.SheetNames || [];
  const name = names[sheetIndex];
  tableWrapEl.textContent = "";

  if (!name) {
    const empty = document.createElement("p");
    empty.className = "spreadsheet-viewer-empty";
    empty.textContent = "Лист не найден.";
    tableWrapEl.appendChild(empty);
    return;
  }

  activeSheetIndex = sheetIndex;
  const XLSX = globalThis.XLSX;
  const sheet = workbookCache.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });

  const totalRows = rows.length;
  const displayRows = rows.slice(0, MAX_ROWS);
  let maxCols = 0;
  for (const row of displayRows) {
    if (Array.isArray(row) && row.length > maxCols) maxCols = row.length;
  }
  maxCols = Math.min(maxCols, MAX_COLS);

  if (!displayRows.length || maxCols === 0) {
    const empty = document.createElement("p");
    empty.className = "spreadsheet-viewer-empty";
    empty.textContent = "Лист пустой.";
    tableWrapEl.appendChild(empty);
  } else {
    const colWidths = [];
    for (let c = 0; c < maxCols; c += 1) colWidths.push(colMinWidthPx(displayRows, c));

    const table = document.createElement("table");
    table.className = "spreadsheet-viewer-table";
    const colgroup = document.createElement("colgroup");
    for (const w of colWidths) {
      const col = document.createElement("col");
      col.style.width = `${w}px`;
      colgroup.appendChild(col);
    }
    table.appendChild(colgroup);

    const thead = document.createElement("thead");
    const tbody = document.createElement("tbody");

    displayRows.forEach((row, rowIdx) => {
      const tr = document.createElement("tr");
      for (let c = 0; c < maxCols; c += 1) {
        const cell = document.createElement(rowIdx === 0 ? "th" : "td");
        cell.textContent = cellText(Array.isArray(row) ? row[c] : "");
        tr.appendChild(cell);
      }
      if (rowIdx === 0) thead.appendChild(tr);
      else tbody.appendChild(tr);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    tableWrapEl.appendChild(table);
  }

  if (statusEl) {
    const parts = [];
    if (totalRows > MAX_ROWS) parts.push(`Показаны первые ${MAX_ROWS} из ${totalRows} строк`);
    if ((rows[0]?.length || 0) > MAX_COLS) parts.push(`первые ${MAX_COLS} столбцов`);
    if (parts.length) {
      statusEl.hidden = false;
      statusEl.textContent = parts.join("; ") + ".";
    } else {
      statusEl.hidden = true;
      statusEl.textContent = "";
    }
  }

  if (tabsEl && !tabsEl.hidden) {
    tabsEl.querySelectorAll(".spreadsheet-viewer-tab").forEach((btn, i) => {
      const on = i === sheetIndex;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
  }
}

function renderTabs(sheetNames) {
  if (!tabsEl) return;
  tabsEl.textContent = "";
  if (!sheetNames || sheetNames.length <= 1) {
    tabsEl.hidden = true;
    return;
  }
  tabsEl.hidden = false;
  sheetNames.forEach((name, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "spreadsheet-viewer-tab" + (i === 0 ? " is-active" : "");
    btn.textContent = name;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", i === 0 ? "true" : "false");
    btn.addEventListener("click", () => renderSheet(i));
    tabsEl.appendChild(btn);
  });
}

export function closeSpreadsheetViewer() {
  if (!modalEl) return;
  modalEl.style.display = "none";
  workbookCache = null;
  fileNameCache = "";
  if (tableWrapEl) tableWrapEl.textContent = "";
  if (tabsEl) {
    tabsEl.textContent = "";
    tabsEl.hidden = true;
  }
  if (statusEl) {
    statusEl.hidden = true;
    statusEl.textContent = "";
  }
}

/**
 * @param {string} url подписанный URL файла
 * @param {string} fileName
 */
export async function openSpreadsheetViewer(url, fileName) {
  ensureModal();
  const name = fileName || "Таблица";
  fileNameCache = name;
  titleEl.textContent = name;
  tableWrapEl.textContent = "";
  statusEl.hidden = false;
  statusEl.textContent = "Загрузка…";
  tabsEl.hidden = true;
  tabsEl.textContent = "";
  modalEl.style.display = "flex";

  const [XLSX, res] = await Promise.all([
    ensureXlsx(),
    fetch(url, { credentials: "omit" }),
  ]);

  if (!res.ok) {
    throw new Error(`Не удалось загрузить файл (HTTP ${res.status})`);
  }

  const buf = await res.arrayBuffer();
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv")) {
    const text = new TextDecoder("utf-8").decode(buf);
    workbookCache = XLSX.read(text, { type: "string", cellDates: true });
  } else {
    workbookCache = XLSX.read(buf, { type: "array", cellDates: true });
  }

  const sheetNames = workbookCache.SheetNames || [];
  if (!sheetNames.length) {
    statusEl.hidden = true;
    const empty = document.createElement("p");
    empty.className = "spreadsheet-viewer-empty";
    empty.textContent = "В файле нет листов.";
    tableWrapEl.appendChild(empty);
    return;
  }

  statusEl.hidden = true;
  statusEl.textContent = "";
  renderTabs(sheetNames);
  renderSheet(0);
  titleEl.textContent = fileNameCache;
}
