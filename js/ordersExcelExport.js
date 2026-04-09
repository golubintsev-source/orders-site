import { getFilteredOrders, getOrderRowValuesForExcel, ORDERS_EXCEL_HEADERS } from "./orders.js";
import { setMessage } from "./dom.js";

function excelFileNameTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

/** Ширина столбцов по содержимому (SheetJS: wch ≈ число символов). */
function applyAutoColumnWidths(ws, aoa) {
  if (!aoa.length) return;
  const numCols = Math.max(0, ...aoa.map((row) => row.length));
  const cols = [];
  for (let c = 0; c < numCols; c++) {
    let maxLen = 0;
    for (const row of aoa) {
      const v = row[c];
      if (v == null || v === "") continue;
      maxLen = Math.max(maxLen, String(v).length);
    }
    const wch = Math.min(Math.max(maxLen + 2, 8), 255);
    cols.push({ wch });
  }
  ws["!cols"] = cols;
}

export function exportOrdersToExcel() {
  const XLSX = globalThis.XLSX;
  if (XLSX == null) {
    setMessage("Не удалось загрузить модуль Excel. Обновите страницу.", "#d32f2f");
    return;
  }

  const orders = getFilteredOrders();
  const rows = orders.map((o) => getOrderRowValuesForExcel(o));
  const aoa = [ORDERS_EXCEL_HEADERS, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  applyAutoColumnWidths(ws, aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Заказы");
  XLSX.writeFile(wb, `zakazy_${excelFileNameTimestamp()}.xlsx`);
  setMessage(`Файл Excel: ${orders.length} строк`, "");
}
