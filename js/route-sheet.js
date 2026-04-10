import { state } from "./state.js";
import { isOrderHiddenFromUserLite, isUserLite } from "./roles.js";
import { formatOrderIdTypeChip } from "./format.js";

const MAIN_ORDER_TYPES = new Set(["Окна", "Подоконники", "Аллюминий", "Сетки/мелочь"]);
const SHOP_TYPE = "Магазин";

const HEADERS_MAIN = [
  "Заказ",
  "Клиент",
  "Адрес",
  "Описание",
  "Моск.",
  "Конст.",
  "Монтаж",
  "Откосы",
  "Телефон",
];

const HEADERS_SHOP = ["Заказ", "Клиент", "Адрес", "Описание", "Телефон"];

function escapeHtml(s) {
  if (s == null) return "";
  const div = document.createElement("div");
  div.textContent = String(s);
  return div.innerHTML;
}

function getTomorrowIsoDate() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Ключ YYYY-MM-DD для сравнения диапазона (дата отправки). */
function deliveryDateKey(order) {
  const raw = order.delivery_date;
  if (raw == null || String(raw).trim() === "") return null;
  const s = String(raw).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

function isInDateRange(order, fromKey, toKey) {
  const key = deliveryDateKey(order);
  if (!key) return false;
  return key >= fromKey && key <= toKey;
}

function isMainRouteType(order) {
  const t = (order.order_type || "").trim();
  if (!t) return true;
  return MAIN_ORDER_TYPES.has(t);
}

function boolDaNet(v) {
  return v === true || v === 1 || v === "1" ? "да" : "нет";
}

function sortByDeliveryThenId(a, b) {
  const ka = deliveryDateKey(a) || "";
  const kb = deliveryDateKey(b) || "";
  if (ka !== kb) return ka.localeCompare(kb);
  return Number(a.id) - Number(b.id);
}

function getRangeFromDom() {
  const fromEl = document.getElementById("routeSheetDateFrom");
  const toEl = document.getElementById("routeSheetDateTo");
  const fromKey = (fromEl?.value || "").trim();
  const toKey = (toEl?.value || "").trim();
  return { fromKey, toKey, valid: /^\d{4}-\d{2}-\d{2}$/.test(fromKey) && /^\d{4}-\d{2}-\d{2}$/.test(toKey) };
}

function filterMainOrders(orders, fromKey, toKey) {
  return orders
    .filter((o) => isMainRouteType(o) && isInDateRange(o, fromKey, toKey))
    .sort(sortByDeliveryThenId);
}

function filterShopOrders(orders, fromKey, toKey) {
  return orders
    .filter((o) => (o.order_type || "").trim() === SHOP_TYPE && isInDateRange(o, fromKey, toKey))
    .sort(sortByDeliveryThenId);
}

/** Как в таблице заказов: user_lite не видит тип «Магазин». */
function ordersVisibleOnRouteSheet() {
  return (state.allOrders || []).filter((o) => !isOrderHiddenFromUserLite(o));
}

function rowMainHtml(order) {
  const chip = formatOrderIdTypeChip(order.id, order.order_type);
  const mosk =
    order.area_m2 != null && order.area_m2 !== "" ? escapeHtml(String(order.area_m2)) : "";
  const konst =
    order.construction_count != null && order.construction_count !== ""
      ? escapeHtml(String(order.construction_count))
      : "";
  return `<tr>
    <td>${escapeHtml(chip)}</td>
    <td>${escapeHtml(order.client ?? "")}</td>
    <td>${escapeHtml(order.address ?? "")}</td>
    <td>${escapeHtml(order.description ?? "")}</td>
    <td>${mosk}</td>
    <td>${konst}</td>
    <td>${escapeHtml(boolDaNet(order.installation))}</td>
    <td>${escapeHtml(boolDaNet(order.reveals))}</td>
    <td class="route-sheet-col-phone">${escapeHtml(order.phone ?? "")}</td>
  </tr>`;
}

function rowShopHtml(order) {
  const chip = formatOrderIdTypeChip(order.id, order.order_type);
  return `<tr>
    <td>${escapeHtml(chip)}</td>
    <td>${escapeHtml(order.client ?? "")}</td>
    <td>${escapeHtml(order.address ?? "")}</td>
    <td>${escapeHtml(order.description ?? "")}</td>
    <td class="route-sheet-col-phone">${escapeHtml(order.phone ?? "")}</td>
  </tr>`;
}

export function loadRouteSheet() {
  const msgEl = document.getElementById("routeSheetMessage");
  const tbodyMain = document.querySelector("#routeSheetTableMain tbody");
  const tbodyShop = document.querySelector("#routeSheetTableShop tbody");
  if (!tbodyMain || !tbodyShop) return;

  const { fromKey, toKey, valid } = getRangeFromDom();
  if (!valid) {
    if (msgEl) msgEl.textContent = "Укажите даты «с» и «по» в формате ГГГГ-ММ-ДД.";
    tbodyMain.innerHTML = "";
    tbodyShop.innerHTML = "";
    return;
  }
  if (fromKey > toKey) {
    if (msgEl) msgEl.textContent = "Дата «с» не может быть позже даты «по».";
    tbodyMain.innerHTML = "";
    tbodyShop.innerHTML = "";
    return;
  }

  if (msgEl) msgEl.textContent = "";

  const orders = ordersVisibleOnRouteSheet();
  const main = filterMainOrders(orders, fromKey, toKey);
  const shop = filterShopOrders(orders, fromKey, toKey);

  tbodyMain.innerHTML = main.map(rowMainHtml).join("");
  tbodyShop.innerHTML = shop.map(rowShopHtml).join("");
}

function excelFileNameTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
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
    const wch = Math.min(Math.max(maxLen + 2, 8), 255);
    cols.push({ wch });
  }
  ws["!cols"] = cols;
}

function exportSheet(headers, rows, sheetName, filePrefix) {
  const XLSX = globalThis.XLSX;
  if (XLSX == null) {
    const msgEl = document.getElementById("routeSheetMessage");
    if (msgEl) msgEl.textContent = "Не удалось загрузить модуль Excel. Обновите страницу.";
    return;
  }
  const aoa = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  applyAutoColumnWidths(ws, aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${filePrefix}_${excelFileNameTimestamp()}.xlsx`);
}

function rowMainValues(order) {
  return [
    order.id != null ? formatOrderIdTypeChip(order.id, order.order_type) : "",
    order.client ?? "",
    order.address ?? "",
    order.description ?? "",
    order.area_m2 != null && order.area_m2 !== "" ? String(order.area_m2) : "",
    order.construction_count != null && order.construction_count !== "" ? String(order.construction_count) : "",
    boolDaNet(order.installation),
    boolDaNet(order.reveals),
    order.phone ?? "",
  ];
}

function rowShopValues(order) {
  return [
    order.id != null ? formatOrderIdTypeChip(order.id, order.order_type) : "",
    order.client ?? "",
    order.address ?? "",
    order.description ?? "",
    order.phone ?? "",
  ];
}

export function exportRouteSheetMainExcel() {
  const { fromKey, toKey, valid } = getRangeFromDom();
  if (!valid || fromKey > toKey) return;
  const main = filterMainOrders(ordersVisibleOnRouteSheet(), fromKey, toKey);
  const rows = main.map(rowMainValues);
  exportSheet(HEADERS_MAIN, rows, "Маршрут", "marshrutnyy_list");
}

export function exportRouteSheetShopExcel() {
  const { fromKey, toKey, valid } = getRangeFromDom();
  if (!valid || fromKey > toKey) return;
  const shop = filterShopOrders(ordersVisibleOnRouteSheet(), fromKey, toKey);
  const rows = shop.map(rowShopValues);
  exportSheet(HEADERS_SHOP, rows, "Магазин", "marshrutnyy_list_magazin");
}

export function initRouteSheetSection() {
  const shopSection = document.getElementById("routeSheetShopSection");
  if (shopSection) shopSection.hidden = isUserLite();

  const fromEl = document.getElementById("routeSheetDateFrom");
  const toEl = document.getElementById("routeSheetDateTo");
  if (!fromEl || !toEl) return;

  if (!fromEl.dataset.routeSheetBound) {
    fromEl.dataset.routeSheetBound = "1";
    const t = getTomorrowIsoDate();
    fromEl.value = t;
    toEl.value = t;
    const onChange = () => loadRouteSheet();
    fromEl.addEventListener("change", onChange);
    toEl.addEventListener("change", onChange);
  }

  const mainBtn = document.getElementById("routeSheetExportMainBtn");
  const shopBtn = document.getElementById("routeSheetExportShopBtn");
  if (mainBtn && !mainBtn.dataset.routeSheetBound) {
    mainBtn.dataset.routeSheetBound = "1";
    mainBtn.addEventListener("click", () => exportRouteSheetMainExcel());
  }
  if (shopBtn && !shopBtn.dataset.routeSheetBound) {
    shopBtn.dataset.routeSheetBound = "1";
    shopBtn.addEventListener("click", () => exportRouteSheetShopExcel());
  }

  loadRouteSheet();
}
