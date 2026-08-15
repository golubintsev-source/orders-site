import { supabaseClient } from "./config.js";
import { formatAmount, formatDateShortRU, formatOrderIdTypeChip } from "./format.js";
import {
  getFilteredCalculationRows,
  getCalcDisplayComment,
  getCalcDisplayAuthor,
  getCalcIncomeExpenseDisplay,
} from "./calculations.js";
import { readSnapshot } from "./offline-cache.js";
import { downloadXlsxBuffer } from "./xlsxDownload.js";
import { ensureXlsx } from "./lazy-cdn.js";
import { fetchSupabaseByIdsInChunks } from "./supabase-fetch.js";

const ORDER_DELTA_CALC_COMMENT_PREFIX = "[AUTO_ORDER_DELTA]";

export const CALCULATIONS_EXCEL_HEADERS = [
  "Дата время",
  "Автор",
  "Доход",
  "Расход",
  "Откуда",
  "Куда",
  "Комментарий",
  "Дата заказа",
  "Номер заказа",
  "Клиент",
  "Адрес",
  "Сумма заказа",
  "Предоплата",
  "Остаток",
  "З/п монтаж",
];

function excelFileNameTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

function formatCalcDateTimeForExcel(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return "";
  }
}

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
    cols.push({ wch: Math.min(Math.max(maxLen + 2, 8), 255) });
  }
  ws["!cols"] = cols;
}

function parseOrderIdFromChip(chip) {
  if (!chip) return null;
  const s = String(chip).trim();
  if (s.startsWith("офл.")) return null;
  const base = s.split("_")[0];
  const n = parseInt(base, 10);
  return Number.isFinite(n) ? n : null;
}

function parseOrderDeltaCommentMeta(comment) {
  if (!comment || !comment.startsWith(ORDER_DELTA_CALC_COMMENT_PREFIX)) return null;
  const body = comment.slice(ORDER_DELTA_CALC_COMMENT_PREFIX.length).trim();
  const parts = body.split(";").map((p) => p.trim());
  if (parts.length < 2) return null;
  const orderChip = parts[1] || "";
  return {
    orderChip,
    clientFromComment: parts[2] || "",
    orderId: parseOrderIdFromChip(orderChip),
  };
}

function collectOrderIdsFromCalculationRows(rows) {
  const ids = new Set();
  for (const row of rows) {
    const meta = parseOrderDeltaCommentMeta(row.comment);
    if (meta?.orderId != null) ids.add(meta.orderId);
  }
  return [...ids];
}

async function fetchOrdersByIds(orderIds) {
  const map = new Map();
  if (!orderIds.length) return map;

  const fromSnapshot = () => {
    const snapOrders = readSnapshot()?.orders;
    if (!Array.isArray(snapOrders)) return;
    for (const o of snapOrders) {
      if (o?.id != null && orderIds.includes(o.id)) map.set(o.id, o);
    }
  };

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    fromSnapshot();
    return map;
  }

  try {
    const { data, error } = await fetchSupabaseByIdsInChunks(
      (chunkIds) =>
        supabaseClient
          .from("orders")
          .select(
            "id, order_date, client, address, amount, prepayment, remaining_amount, installer_payment_amount, order_type"
          )
          .in("id", chunkIds)
          .is("deleted_at", null),
      orderIds,
    );
    if (error) throw error;
    for (const o of data || []) {
      if (o?.id != null) map.set(o.id, o);
    }
  } catch (e) {
    console.warn("Экспорт расчётов: не удалось загрузить заказы, используем кэш.", e);
    fromSnapshot();
  }

  return map;
}

function formatOrderAmountForExcel(v) {
  if (v == null || v === "") return "";
  return formatAmount(v);
}

export function getCalculationRowValuesForExcel(row, orderById) {
  const displayComment = getCalcDisplayComment(row.comment);
  const meta = parseOrderDeltaCommentMeta(row.comment);
  const order = meta?.orderId != null ? orderById.get(meta.orderId) : null;

  const orderNumber =
    order != null
      ? formatOrderIdTypeChip(order.id, order.order_type)
      : meta?.orderChip || "";

  const client =
    order?.client != null && String(order.client).trim() !== ""
      ? String(order.client).trim()
      : meta?.clientFromComment &&
          meta.clientFromComment !== "—" &&
          meta.clientFromComment !== "[__]"
        ? meta.clientFromComment
        : "";

  const { income, expense } = getCalcIncomeExpenseDisplay(row);

  return [
    formatCalcDateTimeForExcel(row.created_at),
    getCalcDisplayAuthor(row.comment),
    income,
    expense,
    row.from_place ?? "",
    row.to_place ?? "",
    displayComment,
    order ? formatDateShortRU(order.order_date) : "",
    orderNumber,
    client,
    order?.address ?? "",
    formatOrderAmountForExcel(order?.amount),
    formatOrderAmountForExcel(order?.prepayment),
    formatOrderAmountForExcel(order?.remaining_amount),
    formatOrderAmountForExcel(order?.installer_payment_amount),
  ];
}

export async function exportCalculationsToExcel() {
  let XLSX;
  try {
    XLSX = await ensureXlsx();
  } catch (e) {
    console.error(e);
    const msgEl = document.getElementById("calculationsMessage");
    if (msgEl) {
      msgEl.textContent = "Не удалось загрузить модуль Excel. Обновите страницу.";
      msgEl.style.color = "#d32f2f";
    }
    return;
  }

  const rows = getFilteredCalculationRows();
  const orderIds = collectOrderIdsFromCalculationRows(rows);
  const orderById = await fetchOrdersByIds(orderIds);
  const dataRows = rows.map((row) => getCalculationRowValuesForExcel(row, orderById));
  const aoa = [CALCULATIONS_EXCEL_HEADERS, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  applyAutoColumnWidths(ws, aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Расчеты");
  const name = `raschety_${excelFileNameTimestamp()}.xlsx`;
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  downloadXlsxBuffer(out, name);

  const msgEl = document.getElementById("calculationsMessage");
  if (msgEl) {
    msgEl.textContent = `Файл Excel: ${rows.length} строк`;
    msgEl.style.color = "";
  }
}
