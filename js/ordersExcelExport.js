import { getFilteredOrders, getOrderRowValuesForExcel, ORDERS_EXCEL_HEADERS } from "./orders.js";
import { setMessage } from "./dom.js";

function excelFileNameTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

export function exportOrdersToExcel() {
  const XLSX = globalThis.XLSX;
  if (XLSX == null) {
    setMessage("Не удалось загрузить модуль Excel. Обновите страницу.", "#d32f2f");
    return;
  }

  const orders = getFilteredOrders();
  const rows = orders.map((o) => getOrderRowValuesForExcel(o));
  const ws = XLSX.utils.aoa_to_sheet([ORDERS_EXCEL_HEADERS, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Заказы");
  XLSX.writeFile(wb, `zakazy_${excelFileNameTimestamp()}.xlsx`);
  setMessage(`Файл Excel: ${orders.length} строк`, "");
}
