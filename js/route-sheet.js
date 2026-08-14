import { state } from "./state.js";
import {
  isOrderEditLockedForUserLite,
  isOrderHiddenForCurrentRole,
  isUserShop,
  canMutateOrders,
} from "./roles.js";
import { formatOrderIdTypeChip, formatDateShortRU, formatAmount, tryParseRublesInteger } from "./format.js";
import { isOrderPaid, loadOrders } from "./orders.js";
import { closeOrderIdActionsMenu, openOrderIdActionsMenu } from "./ui.js";
import { setMessage } from "./dom.js";
import { supabaseClient } from "./config.js";
import { downloadXlsxBuffer } from "./xlsxDownload.js";
import { ensureExcelJs, ensureHtml2Canvas, ensureLeaflet, ensureXlsx } from "./lazy-cdn.js";

const MAIN_ORDER_TYPES = new Set(["Окна", "Подоконники", "Аллюминий", "Сетки/мелочь"]);
const SHOP_TYPE = "Магазин";
const DELIVERY_SHIP = "Доставка";
const DELIVERY_PICKUP = "Самовывоз";

const ROUTE_SHEET_MANUAL_STORAGE_KEY = "routeSheetManualDelivery_v1";

/** Точки доставки, добавленные вручную на маршрутном листе (не заказы в БД). */
const routeSheetManualDeliveryOrders = [];

/** id ручной точки при редактировании в диалоге «Добавить точку»; null — создание. */
let routeSheetAddPointEditingId = null;

function newRouteSheetManualPointId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `rspt-${crypto.randomUUID()}`;
  }
  return `rspt-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function loadRouteSheetManualFromSession() {
  routeSheetManualDeliveryOrders.length = 0;
  try {
    const raw = sessionStorage.getItem(ROUTE_SHEET_MANUAL_STORAGE_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return;
    for (const o of arr) {
      if (o && o.route_sheet_manual === true && o.id != null && String(o.id).startsWith("rspt-")) {
        routeSheetManualDeliveryOrders.push(o);
      }
    }
  } catch {
    routeSheetManualDeliveryOrders.length = 0;
  }
}

function persistRouteSheetManualToSession() {
  try {
    sessionStorage.setItem(ROUTE_SHEET_MANUAL_STORAGE_KEY, JSON.stringify(routeSheetManualDeliveryOrders));
  } catch {
    /* ignore quota */
  }
}

function deleteRouteSheetManualPointById(manualId) {
  const idStr = String(manualId ?? "").trim();
  if (!idStr) return false;
  const idx = routeSheetManualDeliveryOrders.findIndex((o) => String(o.id) === idStr);
  if (idx < 0) return false;
  routeSheetManualDeliveryOrders.splice(idx, 1);
  persistRouteSheetManualToSession();
  return true;
}

/**
 * Текст чипа «Номер» для таблицы, карты и Excel: для ручных точек — автономер (001, 002…), без типа.
 */
function routeSheetOrderChipPlain(order) {
  if (!order) return "";
  if (order.route_sheet_manual === true) {
    const raw = String(order.route_sheet_display_no ?? "").trim();
    if (!raw) return "";
    if (/^\d+$/.test(raw)) return raw.padStart(3, "0");
    return raw;
  }
  if (order.id == null || order.id === "") return "";
  return formatOrderIdTypeChip(order.id, order.order_type);
}

/** Числовой номер ручной точки из `route_sheet_display_no` или текста чипа («001», «001_О»). */
function parseRouteSheetManualDisplayNo(raw) {
  const s = String(raw ?? "").trim();
  const m = s.match(/^(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

/**
 * Следующий свободный номер ручной точки: 001, 002… с учётом уже добавленных на странице.
 * @returns {string}
 */
function nextRouteSheetManualDisplayNo() {
  const used = new Set();
  for (const o of routeSheetManualDeliveryOrders) {
    const n = parseRouteSheetManualDisplayNo(o.route_sheet_display_no);
    if (n != null) used.add(n);
  }
  for (const chip of document.querySelectorAll(".td-order-id--route-sheet-manual .order-id-chip")) {
    const n = parseRouteSheetManualDisplayNo(chip.textContent);
    if (n != null) used.add(n);
  }
  let next = 1;
  while (used.has(next)) next += 1;
  return String(next).padStart(3, "0");
}

function manualDeliveryOrdersInRange(fromKey, toKey) {
  return routeSheetManualDeliveryOrders.filter(
    (o) => o.route_sheet_manual === true && isMainRouteType(o) && isInDateRange(o, fromKey, toKey),
  );
}

const HEADERS_MAIN = [
  "Номер",
  "Клиент",
  "Адрес",
  "Описание",
  "Моск.",
  "Конст.",
  "Монтаж",
  "Откосы",
  "Телефон",
];

/** Экспорт таблицы «Доставка» — с километражем от офиса. */
const HEADERS_DELIVERY = [
  "№",
  "Номер",
  "Клиент",
  "Адрес",
  "Описание",
  "Остаток",
  "Подпись получателя",
];

/**
 * Ширины столбцов «Доставка» в условных единицах Excel (индекс = HEADERS_DELIVERY).
 * Перенос текста по этим ширинам; без «вписать в ширину 1 стр.» — иначе узкие колонки не растягиваются.
 */
const ROUTE_SHEET_DELIVERY_EXCEL_COL_WIDTHS = [2.5, 6.05, 22, 21.6, 27.17, 7.7, 11.88];

/** Родительный падеж месяца для заголовка «Маршрутный лист на …». */
const ROUTE_SHEET_ML_MONTHS_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

const ROUTE_SHEET_DELIVERY_EXCEL_BORDER_THIN = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};

/** Светло-серая заливка строки заголовков таблицы «Доставка» в Excel. */
const ROUTE_SHEET_DELIVERY_EXCEL_HEADER_FILL = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE8E8E8" },
};

/** Центр Волгограда (OSM). */
const VOLGOGRAD_CENTER = [48.708, 44.513];
const VOLGOGRAD_ZOOM_DEFAULT = 11;
const NOMINATIM_DELAY_MS = 1100;

/** Nominatim viewbox: min_lon, max_lat, max_lon, min_lat — границы города Волгоград (relation). */
const NOMINATIM_VIEWBOX_VOLGOGRAD_CITY = "44.1087686,48.8890717,44.6874279,48.4070531";
/** Границы Волгоградской области (fallback, если в городе не найдено). */
const NOMINATIM_VIEWBOX_VOLGOGRAD_OBLAST = "41.1681048,51.2476078,47.4317029,47.4437326";

function normalizeAddrForOfficeCompare(s) {
  return String(s).trim().toLowerCase().replace(/\s+/g, " ");
}

/** Постоянная метка офиса (координаты по OSM / Nominatim для здания). */
const ROUTE_SHEET_OFFICE_ADDRESS = "Автотранспортная улица, 29Ж";
const ROUTE_SHEET_OFFICE_ADDR_NORM = normalizeAddrForOfficeCompare(ROUTE_SHEET_OFFICE_ADDRESS);
const ROUTE_SHEET_OFFICE_LAT = 48.6903978;
const ROUTE_SHEET_OFFICE_LON = 44.4336316;

/**
 * При старте с главного офиса: офис → точка 0 → точка 00 → цель (цепочка OSRM route).
 * Точка 0: 48.693407, 44.436808. Точка 00: 48.687273, 44.453772.
 */
const ROUTE_SHEET_OFFICE_ROUTE_HUB0_LAT = 48.693407;
const ROUTE_SHEET_OFFICE_ROUTE_HUB0_LON = 44.436808;
const ROUTE_SHEET_OFFICE_ROUTE_HUB00_LAT = 48.687273;
const ROUTE_SHEET_OFFICE_ROUTE_HUB00_LON = 44.453772;
/** Не делить на сегменты через хабы, если цель почти у офиса. */
const ROUTE_SHEET_OFFICE_DEPART_MIN_M = 45;

/**
 * Запрет пересечения при построении синих маршрутов (офис → точка, «Составить маршрут», км по OSRM):
 * невидимый отрезок в WGS‑84 (на карте не рисуется). Подгоните координаты под ваш участок.
 * Если концы совпадают или отрезок короче ~8 м, проверка отключена.
 */
const ROUTE_DELIVERY_NO_CROSS_LINE = {
  lat1: 48.690542,
  lon1: 44.430296,
  lat2: 48.687906,
  lon2: 44.442845,
};

function isRouteSheetOfficeDepartLonLat(lon, lat) {
  return Math.abs(lat - ROUTE_SHEET_OFFICE_LAT) < 2e-4 && Math.abs(lon - ROUTE_SHEET_OFFICE_LON) < 2e-4;
}

let routeDeliveryMap = null;
let routeDeliveryOfficeLayer = null;
/** Линия маршрута офис → точка (OSRM), под маркерами доставки. */
let routeDeliveryRouteLayer = null;
let routeDeliveryMarkersLayer = null;
/** Остановки доставки (не у офиса) в порядке обхода таблицы — для OSRM Trip и кнопки «Составить маршрут». */
let routeDeliveryTripStops = [];
/** Показан полный маршрут: не подменять линией «офис → точка» при открытии попапа. */
let routeDeliveryComposedRouteActive = false;
/** Отмена асинхронного составления маршрута. */
let routeDeliveryComposeGeneration = 0;
/** Одна очередь: карта доставки + км; инкремент отменяет текущий проход. */
let routeDeliveryPipelineGeneration = 0;
/** Отмена отрисовки маршрута при новом клике / сбросе карты. */
let routeRoadDrawGeneration = 0;
/** Км и сторона света (Юг/Север) относительно офиса по `order.id`. */
const deliveryKmByOrderId = new Map();
const nominatimCache = new Map();

/** Состояние попапа координат у строки доставки. */
const routeSheetAddressGeoPopoverState = {
  orderId: /** @type {number | null} */ (null),
  manualOrderId: /** @type {string | null} */ (null),
  saveAllowed: false,
  previousCoordinates: "",
  address: "",
};

/** Как «Комментарий» в «Расчётах»: фокус и клавиатура для показа полного текста на iOS. */
const ROUTE_SHEET_DELIVERY_CLAMP_ACTIVABLE =
  ' tabindex="0" role="button" aria-label="Показать полный текст"';

/** На iOS фокус в поле ввода вызывает прокрутку; `routeSheetAddressGeoScrollClose` не должен закрывать попап в этот момент. */
let routeSheetAddressGeoIgnoreScrollUntil = 0;

function escapeHtml(s) {
  if (s == null) return "";
  const div = document.createElement("div");
  div.textContent = String(s);
  return div.innerHTML;
}

function escapeAttr(s) {
  if (s == null || s === "") return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/** Первая колонка: как в таблице «Заказы» — чип номера и меню по клику. */
function orderIdCellHtml(order) {
  if (order.route_sheet_manual === true) {
    const phone = order.phone ?? "";
    const chipText = routeSheetOrderChipPlain(order) || "—";
    const mid = escapeAttr(String(order.id));
    return `<td class="td-order-id td-order-id--route-sheet-manual" data-order-id="${mid}" data-phone="${escapeAttr(phone)}" data-files-count="0" data-lock-edit-user-lite="0">
    <span class="route-sheet-manual-id-row">
      <span class="status-value order-id-chip">${escapeHtml(chipText)}</span>
      <button type="button" class="route-sheet-manual-edit-btn" data-manual-id="${mid}" aria-label="Редактировать точку" title="Редактировать точку">
        <svg class="route-sheet-manual-edit-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
      </button>
      <button type="button" class="route-sheet-manual-delete-btn" data-manual-id="${mid}" aria-label="Удалить точку" title="Удалить точку">
        <svg class="route-sheet-manual-delete-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
      </button>
    </span>
  </td>`;
  }
  const phone = order.phone ?? "";
  const filesCount = state.filesCountMap[order.id] || 0;
  const hasPhone = Boolean((phone || "").trim());
  const orderIdChipClasses = ["status-value", "order-id-chip"];
  if (filesCount > 0) orderIdChipClasses.push("order-id-chip--has-files");
  if (hasPhone) orderIdChipClasses.push("order-id-chip--has-phone");
  if (isOrderEditLockedForUserLite(order)) orderIdChipClasses.push("order-id-chip--lock-user-lite");
  const tasksHighlight =
    order.tasks_highlight === true ||
    order.tasks_highlight === 1 ||
    order.tasks_highlight === "1";
  if (tasksHighlight) orderIdChipClasses.push("order-id-chip--highlight-tasks");
  const orderNumberDisplay =
    order.id != null ? escapeHtml(formatOrderIdTypeChip(order.id, order.order_type)) : "";
  return `<td class="td-order-id" data-order-id="${order.id ?? ""}" data-phone="${escapeAttr(phone)}" data-files-count="${filesCount}" data-lock-edit-user-lite="${isOrderEditLockedForUserLite(order) ? "1" : "0"}">
    <span class="${orderIdChipClasses.join(" ")}">
      ${orderNumberDisplay}
    </span>
  </td>`;
}

/** Колонка «Адрес» в таблице «Доставка» — как `td.td-order-address` в #ordersTable; клик по значению — полный текст и копирование в буфер (см. `onRouteSheetDeliveryTablePointer` в ui.js). */
function deliveryAddressCellHtml(order) {
  const addr = order.address ?? "";
  const addrStr = String(addr);
  const inner = addrStr
    ? `<span class="status-value route-sheet-delivery-clamp-inner" data-fulltext="${escapeAttr(addrStr)}"${ROUTE_SHEET_DELIVERY_CLAMP_ACTIVABLE}>${escapeHtml(addrStr)}</span>`
    : "";
  return `<td class="td-order-address route-sheet-col-address" data-fulltext="${escapeAttr(addrStr)}">${inner}</td>`;
}

/**
 * Сколько дней прибавить к «сегодня» для даты маршрутного листа.
 * Обычно завтра; в пятницу — понедельник (+3), не суббота.
 * @param {number} weekday `Date#getDay()`: 0=вс … 5=пт … 6=сб
 */
function routeSheetDefaultDateDeltaDays(weekday) {
  return weekday === 5 ? 3 : 1;
}

/**
 * Дата доставки по умолчанию для маршрутного листа: завтра.
 * В пятницу — понедельник (не суббота), чтобы не ставить выходной.
 * @param {Date} [now]
 */
function getTomorrowIsoDate(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() + routeSheetDefaultDateDeltaDays(d.getDay()));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Дата, на которую сейчас построен маршрутный лист (поле «с»).
 * «Добавить заказ» должен попадать в видимую таблицу, а не пересчитывать
 * «завтра» отдельно: в пятницу лист уже на понедельнике.
 */
function getRouteSheetActiveDeliveryDate() {
  const fromEl = document.getElementById("routeSheetDateFrom");
  const raw = (fromEl?.value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return getTomorrowIsoDate();
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

/** Хвост в скобках для колонки «Описание» в таблице «Доставка» (площадь, Моск., Конст., при флаге — короткие «Монтаж» / «Откосы»). */
function routeSheetDeliveryDescriptionAppendixPlain(order) {
  const m2 =
    order.area_m2 != null && order.area_m2 !== "" ? String(order.area_m2).trim() : "";
  const mosk =
    order.mosquito_nets != null && order.mosquito_nets !== ""
      ? String(order.mosquito_nets).trim()
      : "";
  const konst =
    order.construction_count != null && order.construction_count !== ""
      ? String(order.construction_count).trim()
      : "";
  const mont = boolDaNet(order.installation);
  const otk = boolDaNet(order.reveals);
  const parts = [];
  if (m2) parts.push(`${m2} м2`);
  if (mosk) parts.push(`Моск. ${mosk}`);
  if (konst) parts.push(`Конст. ${konst}`);
  if (mont === "да") parts.push("Монтаж");
  if (otk === "да") parts.push("Откосы");
  if (parts.length === 0) return "";
  return `(${parts.join("; ")};)`;
}

/** Полный текст описания для «Доставка»: основной текст + хвост в скобках. */
function routeSheetDeliveryDescriptionFullPlain(order) {
  const base = (order.description ?? "").trim();
  const appendix = routeSheetDeliveryDescriptionAppendixPlain(order);
  if (base && appendix) return `${base} ${appendix}`;
  return base || appendix;
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

function filterMainOrdersByShipment(orders, fromKey, toKey, shipment) {
  return filterMainOrders(orders, fromKey, toKey).filter((o) => (o.delivery || "").trim() === shipment);
}

function isShopType(order) {
  return (order?.order_type || "").trim() === SHOP_TYPE;
}

function filterRouteSheetDeliveryOrdersByShipment(orders, fromKey, toKey, shipment) {
  const allowAllTypesForRouteSheetDelivery = isUserShop();
  return orders
    .filter(
      (o) =>
        (o.delivery || "").trim() === shipment &&
        isInDateRange(o, fromKey, toKey) &&
        (allowAllTypesForRouteSheetDelivery || isMainRouteType(o) || isShopType(o)),
    )
    .sort(sortByDeliveryThenId);
}

/**
 * Заказы для выгрузки «Доставка»: только строки с заполненным номером точки,
 * отсортированные по этому номеру (возрастание).
 * @param {object[]} list
 * @returns {{ order: object, pointNum: number }[]}
 */
function ordersDeliveryListForExcelExport(list) {
  if (!list.length) return [];
  const tbody = document.querySelector("#routeSheetTableDelivery tbody");
  const byId = new Map(list.map((o) => [String(o.id ?? ""), o]));
  /** @type {{ order: object, pointNum: number }[]} */
  const entries = [];
  const used = new Set();
  if (tbody) {
    for (const tr of tbody.querySelectorAll("tr")) {
      const numInput = tr.querySelector("input.route-sheet-route-point-num");
      if (!numInput) continue;
      const raw = String(numInput.value ?? "").trim();
      if (!raw) continue;
      const pointNum = Number(raw);
      if (!Number.isFinite(pointNum) || pointNum <= 0) continue;
      const oid = String(tr.querySelector("td.td-order-id")?.getAttribute("data-order-id") ?? "");
      if (!oid || used.has(oid)) continue;
      const order = byId.get(oid);
      if (!order) continue;
      used.add(oid);
      entries.push({ order, pointNum: Math.trunc(pointNum) });
    }
  }
  entries.sort((a, b) => a.pointNum - b.pointNum || String(a.order.id).localeCompare(String(b.order.id)));
  return entries;
}

/**
 * Подсветка и чекбокс по результату распознавания адреса.
 * Нераспознанный адрес: светло-жёлтая строка + снятый чекбокс (по умолчанию не в маршруте).
 * @param {object[]} orders
 * @param {boolean} recognized
 */
function syncRouteSheetDeliveryAddressRecognition(orders, recognized) {
  if (!orders?.length) return;
  const tbody = document.querySelector("#routeSheetTableDelivery tbody");
  if (!tbody) return;
  const idSet = new Set(orders.map((o) => String(o.id ?? "")));
  for (const tr of tbody.querySelectorAll("tr")) {
    const oid = String(tr.querySelector("td.td-order-id")?.getAttribute("data-order-id") ?? "");
    if (!oid || !idSet.has(oid)) continue;
    const cell = tr.querySelector("td.route-sheet-col-route-select");
    if (recognized) {
      tr.classList.remove("route-sheet-row--addr-unrecognized");
      if (!cell) continue;
      const numInput = cell.querySelector("input.route-sheet-route-point-num");
      if (numInput) continue;
      const cb = cell.querySelector("input.route-sheet-route-select-cb");
      if (cb) cb.checked = true;
      else cell.innerHTML = `<input type="checkbox" class="route-sheet-route-select-cb" data-order-id="${escapeAttr(oid)}" checked aria-label="Включить в маршрут" />`;
    } else {
      tr.classList.add("route-sheet-row--addr-unrecognized");
      if (!cell) continue;
      // Номер точки у нераспознанного адреса сбрасываем в снятый чекбокс.
      cell.innerHTML = routeSelectUncheckedCheckboxHtml(oid);
    }
  }
}

function isRouteSheetSectionActive() {
  return document.getElementById("section-route-sheet")?.classList.contains("active") === true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function addressNormKeyFromOrder(order) {
  return String(order.address ?? "").trim().toLowerCase();
}

/** Парсинг строки «48.753016, 44.495766» (широта, долгота). */
function parseLatLonCommaInput(raw) {
  const s = String(raw ?? "").trim();
  const m = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

function formatCoordinatesForStorage(parsed) {
  const sLat = Number(parsed.lat.toFixed(7));
  const sLon = Number(parsed.lon.toFixed(7));
  return `${sLat}, ${sLon}`;
}

/** У заказа заданы сохранённые координаты (валидная строка). */
function orderHasSavedCoordinates(order) {
  return parseLatLonCommaInput(order?.coordinates) != null;
}

/**
 * Группировка точек на карте: при сохранённых координатах — по ним, иначе по нормализованному адресу.
 */
function deliveryPipelineGroupKey(order) {
  const parsed = parseLatLonCommaInput(order?.coordinates);
  if (parsed) return `coord:${parsed.lat},${parsed.lon}`;
  const a = addressNormKeyFromOrder(order);
  return a ? `addr:${a}` : "";
}

/** Юг — точка южнее офиса (меньше широта); Север — севернее. При совпадении широты подпись не добавляем. */
function deliveryHemisphereFromLat(lat) {
  if (!Number.isFinite(lat)) return null;
  const eps = 1e-6;
  const d = lat - ROUTE_SHEET_OFFICE_LAT;
  if (Math.abs(d) <= eps) return null;
  return d < 0 ? "Юг" : "Север";
}

/**
 * @param {number | null | undefined} km
 * @param {number | null | undefined} latForHem широта точки доставки (для Юг/Север)
 * @returns {{ km: number, hem: string | null } | null}
 */
function makeDeliveryKmEntry(km, latForHem) {
  if (km == null || !Number.isFinite(km)) return null;
  const hem = Number.isFinite(latForHem) ? deliveryHemisphereFromLat(latForHem) : null;
  return { km, hem };
}

/** @param {null | { km: number, hem: string | null } | number} entry */
function formatKmCellDisplay(entry) {
  if (entry == null) return "—";
  if (typeof entry === "number") {
    if (!Number.isFinite(entry)) return "—";
    const rounded = Math.round(entry * 10) / 10;
    if (rounded === 0) return "0";
    return String(rounded).replace(".", ",");
  }
  const km = entry.km;
  if (km == null || !Number.isFinite(km)) return "—";
  const rounded = Math.round(km * 10) / 10;
  const numStr = rounded === 0 ? "0" : String(rounded).replace(".", ",");
  const hem = entry.hem;
  if (hem) return `${numStr} (${hem})`;
  return numStr;
}

function truncateForStatus(s, maxLen) {
  const t = String(s).replace(/\s+/g, " ").trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, Math.max(0, maxLen - 1))}…`;
}

function metersPerDegreeLat() {
  return 111_320;
}

function metersPerDegreeLonAt(lat) {
  return 111_320 * Math.cos((lat * Math.PI) / 180);
}

/** Расстояние от точки P до отрезка A–B в метрах (локальная плоскость, достаточно для ~30 м). */
function pointSegmentDistanceMeters(latA, lonA, latB, lonB, latP, lonP) {
  const mLon = metersPerDegreeLonAt((latA + latB + latP) / 3);
  const mLat = metersPerDegreeLat();
  const ax = lonA * mLon;
  const ay = latA * mLat;
  const bx = lonB * mLon;
  const by = latB * mLat;
  const px = lonP * mLon;
  const py = latP * mLat;
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  if (len2 < 1e-12) return Math.hypot(px - ax, py - ay);
  const wx = px - ax;
  const wy = py - ay;
  const t = (vx * wx + vy * wy) / len2;
  if (t <= 0) return Math.hypot(px - ax, py - ay);
  if (t >= 1) return Math.hypot(px - bx, py - by);
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

/**
 * Расстояние вдоль полилинии от её начала до ближайшей к (latP,lonP) точки на линии (метры).
 * Нужно для порядка подписей 1, 2, 3… по фактическому ходу маршрута (OSRM waypoints могут быть в порядке ввода).
 */
function distanceAlongPolylineToClosestPointMeters(latLngs, latP, lonP) {
  if (!Array.isArray(latLngs) || latLngs.length < 2) return 0;
  let bestAlong = 0;
  let bestDist = Infinity;
  let cumAtSegStart = 0;
  for (let i = 0; i < latLngs.length - 1; i++) {
    const [lat1, lon1] = latLngs[i];
    const [lat2, lon2] = latLngs[i + 1];
    const mLon = metersPerDegreeLonAt((lat1 + lat2 + latP) / 3);
    const mLat = metersPerDegreeLat();
    const segLen = Math.hypot((lon2 - lon1) * mLon, (lat2 - lat1) * mLat);
    const dist = pointSegmentDistanceMeters(lat1, lon1, lat2, lon2, latP, lonP);
    const ax = lon1 * mLon;
    const ay = lat1 * mLat;
    const bx = lon2 * mLon;
    const by = lat2 * mLat;
    const px = lonP * mLon;
    const py = latP * mLat;
    const vx = bx - ax;
    const vy = by - ay;
    const len2 = vx * vx + vy * vy;
    let t = 0;
    if (len2 > 1e-18) {
      t = ((px - ax) * vx + (py - ay) * vy) / len2;
      t = Math.max(0, Math.min(1, t));
    }
    const along = cumAtSegStart + t * segLen;
    if (dist < bestDist - 1e-6) {
      bestDist = dist;
      bestAlong = along;
    } else if (Math.abs(dist - bestDist) <= 1e-6 && along < bestAlong) {
      bestAlong = along;
    }
    cumAtSegStart += segLen;
  }
  return bestAlong;
}

function routeGeometryToLatLngs(route) {
  const coords = route?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const latLngs = coords.map((c) => {
    const lon = Number(c[0]);
    const lat = Number(c[1]);
    return Number.isFinite(lat) && Number.isFinite(lon) ? /** @type {[number, number]} */ ([lat, lon]) : null;
  }).filter((x) => x != null);
  return latLngs.length >= 2 ? latLngs : null;
}

/** Склейка сегментов [lat,lng] в одну линию без дублирования стыков. */
function mergeAdjacentRoutePolylines(segments) {
  if (!Array.isArray(segments) || !segments.length) return null;
  /** @type {Array<[number, number]>} */
  const out = [];
  const eps = 1e-7;
  for (const seg of segments) {
    if (!Array.isArray(seg) || seg.length < 2) continue;
    if (out.length === 0) {
      for (const p of seg) out.push(p);
      continue;
    }
    const last = out[out.length - 1];
    const first = seg[0];
    const dup =
      Array.isArray(last) &&
      Array.isArray(first) &&
      Math.abs(last[0] - first[0]) < eps &&
      Math.abs(last[1] - first[1]) < eps;
    const rest = dup ? seg.slice(1) : seg;
    for (const p of rest) out.push(p);
  }
  return out.length >= 2 ? out : null;
}

function approxDistanceMeters(lat1, lon1, lat2, lon2) {
  const mLat = metersPerDegreeLat();
  const mLon = metersPerDegreeLonAt((lat1 + lat2) / 2);
  return Math.hypot((lat2 - lat1) * mLat, (lon2 - lon1) * mLon);
}

/** @returns {{ lat1: number, lon1: number, lat2: number, lon2: number } | null} */
function deliveryNoCrossBarrierLonLatPair() {
  const a = ROUTE_DELIVERY_NO_CROSS_LINE;
  if (!a) return null;
  const lat1 = Number(a.lat1);
  const lon1 = Number(a.lon1);
  const lat2 = Number(a.lat2);
  const lon2 = Number(a.lon2);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
  if (approxDistanceMeters(lat1, lon1, lat2, lon2) < 8) return null;
  return { lat1, lon1, lat2, lon2 };
}

/**
 * Пересечение отрезков A–B и C–D в локальной плоскости (м), включая концы.
 * Параллельные отрезки без учёта совпадения — как «нет пересечения» (для маршрутов редко).
 */
function segmentsIntersectInclusivePlane(ax, ay, bx, by, cx, cy, dx, dy, eps = 1e-7) {
  const rx = bx - ax;
  const ry = by - ay;
  const sx = dx - cx;
  const sy = dy - cy;
  const denom = rx * sy - ry * sx;
  const qpx = cx - ax;
  const qpy = cy - ay;
  const scale = Math.max(1, Math.abs(rx) + Math.abs(ry) + Math.abs(sx) + Math.abs(sy));
  if (Math.abs(denom) < eps * scale) return false;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;
  return t >= -eps && t <= 1 + eps && u >= -eps && u <= 1 + eps;
}

function segmentPairIntersectsLatLon(aLat, aLon, bLat, bLon, cLat, cLon, dLat, dLon) {
  const refLat = (aLat + bLat + cLat + dLat) / 4;
  const mLon = metersPerDegreeLonAt(refLat);
  const mLat = metersPerDegreeLat();
  const ax = aLon * mLon;
  const ay = aLat * mLat;
  const bx = bLon * mLon;
  const by = bLat * mLat;
  const cx = cLon * mLon;
  const cy = cLat * mLat;
  const dx = dLon * mLon;
  const dy = dLat * mLat;
  return segmentsIntersectInclusivePlane(ax, ay, bx, by, cx, cy, dx, dy);
}

/**
 * Есть ли у полилинии [[lat,lon],…] пересечение с запретным отрезком.
 * @param {Array<[number, number]>} latLngs
 * @param {{ lat1: number, lon1: number, lat2: number, lon2: number }} barrier
 */
function polylineIntersectsBarrierSegment(latLngs, barrier) {
  if (!barrier || !Array.isArray(latLngs) || latLngs.length < 2) return false;
  const { lat1, lon1, lat2, lon2 } = barrier;
  for (let i = 0; i < latLngs.length - 1; i++) {
    const p = latLngs[i];
    const q = latLngs[i + 1];
    if (!Array.isArray(p) || !Array.isArray(q) || p.length < 2 || q.length < 2) continue;
    const [plat1, plon1] = p;
    const [plat2, plon2] = q;
    if (
      segmentPairIntersectsLatLon(plat1, plon1, plat2, plon2, lat1, lon1, lat2, lon2)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Один запрос OSRM route: среди альтернатив выбирается кратчайший по distance.
 * @returns {Promise<{ latLngs: Array<[number, number]>, distanceMeters: number } | null>}
 */
async function osrmFetchDrivingRouteOnce(fromLon, fromLat, toLon, toLat) {
  const coordStr = `${fromLon},${fromLat};${toLon},${toLat}`;
  const base = `https://router.project-osrm.org/route/v1/driving/${coordStr}`;
  const urls = [
    `${base}?overview=full&geometries=geojson&alternatives=3`,
    `${base}?overview=full&geometries=geojson`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) continue;
      const json = await res.json();
      if (json.code !== "Ok" || !Array.isArray(json.routes) || !json.routes.length) continue;
      const barrier = deliveryNoCrossBarrierLonLatPair();
      /** @type {{ latLngs: Array<[number, number]>, distanceMeters: number } | null} */
      let best = null;
      for (const r of json.routes) {
        const latLngs = routeGeometryToLatLngs(r);
        const distanceM = Number(r.distance);
        if (!latLngs || !Number.isFinite(distanceM)) continue;
        if (barrier && polylineIntersectsBarrierSegment(latLngs, barrier)) continue;
        if (!best || distanceM < best.distanceMeters) best = { latLngs, distanceMeters: distanceM };
      }
      if (best) return best;
    } catch {
      /* следующий URL */
    }
  }
  return null;
}

/**
 * Маршрут по дорогам (OSRM). Старт с офиса: офис → точка 0 → точка 00 → цель.
 * @returns {Promise<{ latLngs: Array<[number, number]>, distanceMeters: number } | null>}
 */
async function osrmFetchDrivingRoutesResolved(fromLon, fromLat, toLon, toLat) {
  const h0Lat = ROUTE_SHEET_OFFICE_ROUTE_HUB0_LAT;
  const h0Lon = ROUTE_SHEET_OFFICE_ROUTE_HUB0_LON;
  const h00Lat = ROUTE_SHEET_OFFICE_ROUTE_HUB00_LAT;
  const h00Lon = ROUTE_SHEET_OFFICE_ROUTE_HUB00_LON;
  const destFar = approxDistanceMeters(fromLat, fromLon, toLat, toLon) >= ROUTE_SHEET_OFFICE_DEPART_MIN_M;
  if (isRouteSheetOfficeDepartLonLat(fromLon, fromLat) && destFar) {
    const leg1 = await osrmFetchDrivingRouteOnce(fromLon, fromLat, h0Lon, h0Lat);
    const leg2 = await osrmFetchDrivingRouteOnce(h0Lon, h0Lat, h00Lon, h00Lat);
    const leg3 = await osrmFetchDrivingRouteOnce(h00Lon, h00Lat, toLon, toLat);
    if (leg1?.latLngs?.length && leg2?.latLngs?.length && leg3?.latLngs?.length) {
      const merged = mergeAdjacentRoutePolylines([leg1.latLngs, leg2.latLngs, leg3.latLngs]);
      if (merged?.length) {
        const barrier = deliveryNoCrossBarrierLonLatPair();
        if (!barrier || !polylineIntersectsBarrierSegment(merged, barrier)) {
          return {
            latLngs: merged,
            distanceMeters: leg1.distanceMeters + leg2.distanceMeters + leg3.distanceMeters,
          };
        }
      }
    }
  }
  return osrmFetchDrivingRouteOnce(fromLon, fromLat, toLon, toLat);
}

/** Одна пара точек: офис → адрес (км по дорогам, OSRM). */
async function osrmDrivingDistanceKm(fromLon, fromLat, toLon, toLat) {
  const picked = await osrmFetchDrivingRoutesResolved(fromLon, fromLat, toLon, toLat);
  if (!picked) return null;
  return picked.distanceMeters / 1000;
}

/**
 * Геометрия маршрута по дорогам (OSRM): массив [lat, lng] для Leaflet.
 * @returns {Promise<Array<[number, number]>|null>}
 */
async function osrmDrivingRouteLatLngs(fromLon, fromLat, toLon, toLat) {
  const picked = await osrmFetchDrivingRoutesResolved(fromLon, fromLat, toLon, toLat);
  return picked?.latLngs ?? null;
}

/**
 * Оптимальный порядок объезда: старт — первая точка (офис), без возврата.
 * @returns {Promise<{ latLngs: Array<[number, number]>, distanceM: number, waypoints: object[] } | null>}
 */
async function osrmTripDrivingResolved(officeLon, officeLat, stops) {
  if (!stops?.length) return null;
  const parts = [`${officeLon},${officeLat}`];
  for (const s of stops) {
    parts.push(`${s.lon},${s.lat}`);
  }
  const coordStr = parts.join(";");
  const url = `https://router.project-osrm.org/trip/v1/driving/${coordStr}?source=first&roundtrip=false&destination=any&overview=full&geometries=geojson`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.code !== "Ok" || !Array.isArray(json.trips) || !json.trips.length) return null;
    const trip = json.trips[0];
    const tripLatLngs = routeGeometryToLatLngs(trip);
    if (!tripLatLngs?.length) return null;
    const distanceM = Number(trip.distance);
    if (!Number.isFinite(distanceM)) return null;
    const waypoints = Array.isArray(json.waypoints) ? json.waypoints : [];
    const barrier = deliveryNoCrossBarrierLonLatPair();
    const tripCrossesBarrier = Boolean(barrier && polylineIntersectsBarrierSegment(tripLatLngs, barrier));

    /** Порядок посещения из trip; дальше — сегменты `route` с alternatives и обходом закрытых участков. */
    const visitOrdered = waypoints
      .map((w, inputIdx) => ({
        inputIdx,
        order: Number(w.waypoint_index),
        lon: Array.isArray(w.location) ? Number(w.location[0]) : NaN,
        lat: Array.isArray(w.location) ? Number(w.location[1]) : NaN,
      }))
      .filter((x) => Number.isFinite(x.order) && Number.isFinite(x.lon) && Number.isFinite(x.lat))
      .sort((a, b) => (a.order !== b.order ? a.order - b.order : a.inputIdx - b.inputIdx));

    if (visitOrdered.length < 2) {
      if (tripCrossesBarrier) return null;
      return { latLngs: tripLatLngs, distanceM, waypoints };
    }

    /** @type {Array<[number, number]>[]} */
    const segmentPolylines = [];
    let stitchedDm = 0;
    for (let i = 0; i < visitOrdered.length - 1; i++) {
      const a = visitOrdered[i];
      const b = visitOrdered[i + 1];
      const leg = await osrmFetchDrivingRoutesResolved(a.lon, a.lat, b.lon, b.lat);
      if (!leg?.latLngs?.length) {
        if (tripCrossesBarrier) return null;
        return { latLngs: tripLatLngs, distanceM, waypoints };
      }
      segmentPolylines.push(leg.latLngs);
      stitchedDm += leg.distanceMeters;
    }

    const merged = mergeAdjacentRoutePolylines(segmentPolylines);
    if (!merged?.length) {
      if (tripCrossesBarrier) return null;
      return { latLngs: tripLatLngs, distanceM, waypoints };
    }
    if (!barrier || !polylineIntersectsBarrierSegment(merged, barrier)) {
      return { latLngs: merged, distanceM: stitchedDm, waypoints };
    }
    if (!tripCrossesBarrier) {
      return { latLngs: tripLatLngs, distanceM, waypoints };
    }
    return null;
  } catch (e) {
    console.error("OSRM trip:", e);
    return null;
  }
}

function bindDeliveryMarkerPopupOpenRoute(marker) {
  marker.on("popupopen", () => {
    if (routeDeliveryComposedRouteActive) return;
    void showDeliveryRoadRouteFromOffice(marker.getLatLng());
  });
}

function invalidateRoadRouteDraw() {
  routeRoadDrawGeneration += 1;
}

function clearRouteDeliveryRoadRouteLayer() {
  routeDeliveryRouteLayer?.clearLayers();
}

const ROUTE_SHEET_COMPOSE_PENDING_CLASS = "route-sheet-route-time-estimate--composing";

function clearRouteDeliveryTripTimeEstimate() {
  const el = document.getElementById("routeSheetRouteTimeEstimate");
  if (!el) return;
  el.classList.remove(ROUTE_SHEET_COMPOSE_PENDING_CLASS);
  el.textContent = "";
  el.hidden = true;
}

function setRouteDeliveryTripComposePending(myGen) {
  const el = document.getElementById("routeSheetRouteTimeEstimate");
  if (!el) return;
  if (myGen !== routeDeliveryComposeGeneration) return;
  el.textContent = "составляем маршрут";
  el.classList.add(ROUTE_SHEET_COMPOSE_PENDING_CLASS);
  el.hidden = false;
}

function setRouteDeliveryTripTimeEstimate(text) {
  const el = document.getElementById("routeSheetRouteTimeEstimate");
  if (!el) return;
  el.classList.remove(ROUTE_SHEET_COMPOSE_PENDING_CLASS);
  if (!text) {
    clearRouteDeliveryTripTimeEstimate();
    return;
  }
  el.textContent = text;
  el.hidden = false;
}

/** Расстояние по дорогам (OSRM), м + 30 мин выгрузки на точку → примерное время при 20 км/ч. */
function formatApproxTravelTimeAt20Kmh(distanceMeters, deliveryStopCount = 0) {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return "";
  const stops =
    Number.isFinite(deliveryStopCount) && deliveryStopCount > 0
      ? Math.floor(deliveryStopCount)
      : 0;
  const travelMin =
    distanceMeters > 0 ? Math.max(1, Math.round((distanceMeters / 1000 / 20) * 60)) : 0;
  const unloadMin = stops * 30;
  const totalMin = travelMin + unloadMin;
  if (totalMin <= 0) return "";
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const suffix = " (20 км/ч, 30 мин точка)";
  if (h === 0) return `≈ ${m} мин${suffix}`;
  if (m === 0) return `≈ ${h} ч${suffix}`;
  return `≈ ${h} ч ${m} мин${suffix}`;
}

function isStopFarFromOfficeLatLon(lat, lon) {
  const L = globalThis.L;
  if (!L || !Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return routeSheetOfficeLatLng(L).distanceTo(L.latLng(lat, lon)) >= 35;
}

function clearRouteDeliveryMapLayersOnly() {
  invalidateRoadRouteDraw();
  routeDeliveryMarkersLayer?.clearLayers();
  clearRouteDeliveryRoadRouteLayer();
}

function clearRouteDeliveryMarkersAndRoadRoute() {
  clearRouteDeliveryMapLayersOnly();
  routeDeliveryTripStops = [];
  routeDeliveryComposedRouteActive = false;
  clearRouteDeliveryTripTimeEstimate();
}

/** По клику на маркер доставки: линия офис → точка по OSRM. */
async function showDeliveryRoadRouteFromOffice(destLatLng) {
  const L = globalThis.L;
  if (!L || !routeDeliveryRouteLayer || !destLatLng) return;
  if (routeDeliveryComposedRouteActive) return;
  const officeLL = routeSheetOfficeLatLng(L);
  if (officeLL.distanceTo(destLatLng) < 35) {
    invalidateRoadRouteDraw();
    clearRouteDeliveryRoadRouteLayer();
    return;
  }

  const myGen = ++routeRoadDrawGeneration;
  clearRouteDeliveryRoadRouteLayer();

  let pts;
  try {
    pts = await osrmDrivingRouteLatLngs(
      ROUTE_SHEET_OFFICE_LON,
      ROUTE_SHEET_OFFICE_LAT,
      destLatLng.lng,
      destLatLng.lat,
    );
  } catch (e) {
    console.error("OSRM route:", e);
    if (myGen === routeRoadDrawGeneration) {
      setRouteDeliveryMapStatus("Не удалось построить маршрут по дорогам.", true);
    }
    return;
  }

  if (myGen !== routeRoadDrawGeneration) return;
  if (!pts?.length) {
    setRouteDeliveryMapStatus(
      deliveryNoCrossBarrierLonLatPair()
        ? "Маршрут не найден без пересечения красной линии на карте."
        : "Маршрут по дорогам не найден.",
      true,
    );
    return;
  }

  L.polyline(pts, {
    color: "#1d4ed8",
    weight: 5,
    opacity: 0.9,
    lineJoin: "round",
    lineCap: "round",
  }).addTo(routeDeliveryRouteLayer);
}

function setComposeRouteButtonBusy(busy) {
  const btn = document.getElementById("routeSheetComposeRouteBtn");
  if (!btn) return;
  btn.disabled = Boolean(busy);
  btn.setAttribute("aria-busy", busy ? "true" : "false");
}

/**
 * Id заказов, участвующих в маршруте: есть номер точки или отмечен чекбокс.
 * Не участвуют только строки с пустым (снятым) чекбоксом.
 */
function getRouteSheetDeliverySelectedOrderIds() {
  const tbody = document.querySelector("#routeSheetTableDelivery tbody");
  /** @type {Set<string>} */
  const ids = new Set();
  if (!tbody) return ids;
  for (const tr of tbody.querySelectorAll("tr")) {
    const oid = String(tr.querySelector("td.td-order-id")?.getAttribute("data-order-id") ?? "").trim();
    if (!oid) continue;
    const numInput = tr.querySelector("input.route-sheet-route-point-num");
    if (numInput && String(numInput.value ?? "").trim() !== "") {
      ids.add(oid);
      continue;
    }
    const cb = tr.querySelector("input.route-sheet-route-select-cb");
    if (cb?.checked) ids.add(oid);
  }
  return ids;
}

/** HTML снятого чекбокса «в маршрут» (после удаления номера точки). */
function routeSelectUncheckedCheckboxHtml(orderId) {
  const oid = escapeAttr(String(orderId ?? ""));
  return `<input type="checkbox" class="route-sheet-route-select-cb" data-order-id="${oid}" aria-label="Включить в маршрут" />`;
}

/** HTML редактируемого поля номера точки маршрута. */
function routePointNumInputHtml(pointNum) {
  const n = String(pointNum);
  return `<input type="text" class="route-sheet-route-point-num" value="${escapeAttr(n)}" inputmode="numeric" aria-label="Номер точки маршрута ${escapeAttr(n)}" />`;
}

/**
 * Если номер точки стёрт — заменить поле на снятый чекбокс (только после ухода фокуса).
 * @param {HTMLInputElement} input
 */
function maybeConvertClearedRoutePointNumToCheckbox(input) {
  if (!input?.classList?.contains("route-sheet-route-point-num")) return;
  if (String(input.value ?? "").trim() !== "") return;
  const cell = input.closest("td.route-sheet-col-route-select");
  const tr = input.closest("tr");
  const oid = String(tr?.querySelector("td.td-order-id")?.getAttribute("data-order-id") ?? "").trim();
  if (!cell || !oid) return;
  cell.innerHTML = routeSelectUncheckedCheckboxHtml(oid);
}

/** Курсор в конец поля номера точки (удобнее править на телефоне). */
function placeRoutePointNumCaretAtEnd(input) {
  if (!(input instanceof HTMLInputElement)) return;
  if (!input.classList.contains("route-sheet-route-point-num")) return;
  const len = String(input.value ?? "").length;
  try {
    input.setSelectionRange(len, len);
  } catch {
    /* ignore */
  }
}

/**
 * Ячейка выбора: чекбокс до составления маршрута; после — узкое поле с номером точки.
 * @param {object} order
 * @param {{ routePointNum?: number | null }} [opts]
 */
function routeSelectCellHtml(order, opts = {}) {
  const oid = escapeAttr(String(order.id ?? ""));
  const pointNum = opts.routePointNum;
  if (pointNum != null && Number.isFinite(Number(pointNum)) && Number(pointNum) > 0) {
    const n = String(Math.trunc(Number(pointNum)));
    return `<td class="route-sheet-col-route-select">
    ${routePointNumInputHtml(n)}
  </td>`;
  }
  return `<td class="route-sheet-col-route-select">
    <input type="checkbox" class="route-sheet-route-select-cb" data-order-id="${oid}" checked aria-label="Включить в маршрут" />
  </td>`;
}

/**
 * После «Составить маршрут»: у участвовавших строк — номер точки вместо чекбокса.
 * @param {Array<{ stop: { ordersHere?: object[] }, idx: number, along: number }>} orderedStops
 */
function applyRouteSheetDeliveryPointNumbers(orderedStops) {
  const tbody = document.querySelector("#routeSheetTableDelivery tbody");
  if (!tbody || !Array.isArray(orderedStops) || !orderedStops.length) return;

  /** @type {Map<string, number>} */
  const orderIdToSeq = new Map();
  let seq = 0;
  for (const { stop } of orderedStops) {
    if (!stop?.ordersHere?.length) continue;
    seq += 1;
    for (const o of stop.ordersHere) {
      const sid = o.id != null ? String(o.id) : "";
      if (sid) orderIdToSeq.set(sid, seq);
    }
  }
  if (!orderIdToSeq.size) return;

  for (const tr of tbody.querySelectorAll("tr")) {
    const oid = String(tr.querySelector("td.td-order-id")?.getAttribute("data-order-id") ?? "");
    const cell = tr.querySelector("td.route-sheet-col-route-select");
    if (!cell || !oid) continue;
    const pointNum = orderIdToSeq.get(oid);
    if (pointNum == null) continue;
    cell.innerHTML = routePointNumInputHtml(pointNum);
  }
}

/**
 * После «Составить маршрут»: строки «Доставка» — в порядке объезда (как нумерация на карте).
 * Заказы вне trip (офис/рядом и т.п.) остаются внизу в прежнем относительном порядке.
 * @param {Array<{ stop: { ordersHere?: object[] }, idx: number, along: number }>} orderedStops
 */
function reorderRouteSheetDeliveryTbodyByOrderedStops(orderedStops) {
  const tbody = document.querySelector("#routeSheetTableDelivery tbody");
  if (!tbody || !Array.isArray(orderedStops) || !orderedStops.length) return;

  const routedOrderIds = [];
  const seenId = new Set();
  for (const { stop } of orderedStops) {
    if (!stop?.ordersHere) continue;
    for (const o of stop.ordersHere) {
      const sid = o.id != null ? String(o.id) : "";
      if (!sid || seenId.has(sid)) continue;
      seenId.add(sid);
      routedOrderIds.push(sid);
    }
  }
  if (!routedOrderIds.length) return;

  const rowsByOrderId = new Map();
  const allTrs = [];
  for (const tr of tbody.querySelectorAll("tr")) {
    allTrs.push(tr);
    const oid = String(tr.querySelector("td.td-order-id")?.getAttribute("data-order-id") ?? "");
    if (oid) rowsByOrderId.set(oid, tr);
  }

  const routedSet = new Set(routedOrderIds);
  const tail = [];
  for (const tr of allTrs) {
    const oid = String(tr.querySelector("td.td-order-id")?.getAttribute("data-order-id") ?? "");
    if (!oid || !routedSet.has(oid)) tail.push(tr);
  }

  for (const sid of routedOrderIds) {
    const tr = rowsByOrderId.get(sid);
    if (tr) tbody.appendChild(tr);
  }
  for (const tr of tail) tbody.appendChild(tr);
  syncRouteSheetDeliveryAddressTitles();
}

async function composeDeliveryRoute() {
  const L = globalThis.L;
  if (!L || !routeDeliveryMap || !routeDeliveryRouteLayer || !routeDeliveryMarkersLayer) {
    setRouteDeliveryMapStatus("Карта ещё не готова. Подождите загрузки точек.", true);
    return;
  }

  const selectedIds = getRouteSheetDeliverySelectedOrderIds();
  if (!selectedIds.size) {
    setRouteDeliveryMapStatus(
      "Отметьте заказы галочками или оставьте номера точек для составления маршрута.",
      true,
    );
    return;
  }

  const stopsSnapshot = routeDeliveryTripStops
    .map((s) => ({
      lat: s.lat,
      lon: s.lon,
      ordersHere: (s.ordersHere || []).filter((o) => selectedIds.has(String(o.id ?? ""))),
    }))
    .filter((s) => s.ordersHere.length > 0);
  if (!stopsSnapshot.length) {
    setRouteDeliveryMapStatus(
      routeDeliveryTripStops.length
        ? "Среди отмеченных заказов нет адресов для маршрута: укажите координаты или дождитесь окончания загрузки карты."
        : "Нет адресов для маршрута: укажите координаты или дождитесь окончания загрузки карты.",
      true,
    );
    return;
  }

  const myGen = ++routeDeliveryComposeGeneration;
  setComposeRouteButtonBusy(true);
  setRouteDeliveryTripComposePending(myGen);

  try {
    const picked = await osrmTripDrivingResolved(
      ROUTE_SHEET_OFFICE_LON,
      ROUTE_SHEET_OFFICE_LAT,
      stopsSnapshot,
    );
    if (myGen !== routeDeliveryComposeGeneration) return;
    if (!picked) {
      clearRouteDeliveryTripTimeEstimate();
      setRouteDeliveryMapStatus(
        deliveryNoCrossBarrierLonLatPair()
          ? "Не удалось составить маршрут без пересечения красной линии. Попробуйте позже или измените точки."
          : "Не удалось составить маршрут по дорогам. Попробуйте позже.",
        true,
      );
      return;
    }

    clearRouteDeliveryMapLayersOnly();

    const { latLngs, distanceM: distM } = picked;

    L.polyline(latLngs, {
      color: "#1d4ed8",
      weight: 5,
      opacity: 0.9,
      lineJoin: "round",
      lineCap: "round",
    }).addTo(routeDeliveryRouteLayer);

    /** Порядок 1…n по ходу синей линии (OSRM waypoints при N>5 не всегда в порядке объезда). */
    const ordered = stopsSnapshot
      .map((stop, idx) => ({
        stop,
        idx,
        along: distanceAlongPolylineToClosestPointMeters(latLngs, stop.lat, stop.lon),
      }))
      .sort((a, b) => (a.along !== b.along ? a.along - b.along : a.idx - b.idx));

    let seq = 0;
    for (const { stop } of ordered) {
      if (!stop?.ordersHere) continue;
      seq += 1;
      const latlng = L.latLng(stop.lat, stop.lon);
      const marker = L.marker(latlng, {
        icon: deliveryMapMarkerIconNumbered(L, stop.ordersHere, seq),
      });
      marker.bindPopup(buildDeliveryPopupHtml(stop.ordersHere));
      bindDeliveryMarkerPopupOpenRoute(marker);
      marker.addTo(routeDeliveryMarkersLayer);
    }

    reorderRouteSheetDeliveryTbodyByOrderedStops(ordered);
    applyRouteSheetDeliveryPointNumbers(ordered);

    routeDeliveryComposedRouteActive = true;
    setRouteDeliveryTripTimeEstimate(
      formatApproxTravelTimeAt20Kmh(distM, stopsSnapshot.length),
    );

    const b = L.latLngBounds(latLngs);
    b.extend(routeSheetOfficeLatLng(L));
    routeDeliveryMap.fitBounds(b, { padding: [32, 32], maxZoom: 15 });
    setRouteDeliveryMapStatus("");
    scheduleInvalidateRouteDeliveryMap();
  } catch (e) {
    console.error("composeDeliveryRoute:", e);
    if (myGen === routeDeliveryComposeGeneration) {
      clearRouteDeliveryTripTimeEstimate();
      setRouteDeliveryMapStatus("Ошибка при составлении маршрута.", true);
    }
  } finally {
    setComposeRouteButtonBusy(false);
  }
}

function updateKmCellsForOrders(orders) {
  if (!orders.length) return;
  const tbody = document.querySelector("#routeSheetTableDelivery tbody");
  if (!tbody) return;
  const idSet = new Set(orders.map((o) => String(o.id ?? "")));
  for (const tr of tbody.querySelectorAll("tr")) {
    const idTd = tr.querySelector("td.td-order-id");
    const oid = String(idTd?.getAttribute("data-order-id") ?? "");
    if (!idSet.has(oid)) continue;
    const td = tr.querySelector("td.route-sheet-col-km");
    if (!td) continue;
    const order = orders.find((o) => String(o.id ?? "") === oid);
    const cell = order != null ? deliveryKmByOrderId.get(order.id) : undefined;
    const chip = td.querySelector(".status-value");
    const text = formatKmCellDisplay(cell);
    if (chip) chip.textContent = text;
    else td.textContent = text;
  }
}

function geocodeNominatimCacheKey(normalizedQuery) {
  return `v4|${String(normalizedQuery).trim().toLowerCase()}`;
}

/** Ключ строки в `route_sheet_address_geo` (совпадает с нормализацией кэша Nominatim). */
function routeSheetGeoDbKeyFromDisplayAddress(displayAddr) {
  const searchAddr = addressForNominatimSearch(String(displayAddr).trim());
  const k = String(searchAddr).trim().toLowerCase();
  return k || null;
}

/** @param {object | null | undefined} data */
function parseRouteSheetAddressGeoRow(data) {
  if (!data) return null;
  const lat = Number(data.lat);
  const lon = Number(data.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const km = data.km_office == null ? null : Number(data.km_office);
  return {
    lat,
    lon,
    km_office: km != null && Number.isFinite(km) ? km : null,
  };
}

function rememberNominatimCoordsForAddress(displayAddr, coords) {
  const searchAddr = addressForNominatimSearch(String(displayAddr ?? "").trim());
  if (!searchAddr || !coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lon)) return;
  nominatimCache.set(geocodeNominatimCacheKey(searchAddr), { lat: coords.lat, lon: coords.lon });
}

function coordsMatchCachedGeo(coords, cached, eps = 1e-5) {
  if (!coords || !cached) return false;
  return Math.abs(cached.lat - coords.lat) <= eps && Math.abs(cached.lon - coords.lon) <= eps;
}

async function fetchRouteSheetAddressGeoFromDb(addressKey) {
  try {
    const { data, error } = await supabaseClient
      .from("route_sheet_address_geo")
      .select("lat, lon, km_office")
      .eq("address_key", addressKey)
      .maybeSingle();
    if (error) {
      console.warn("route_sheet_address_geo:", error.message);
      return null;
    }
    return parseRouteSheetAddressGeoRow(data);
  } catch (e) {
    console.warn("route_sheet_address_geo:", e);
    return null;
  }
}

/**
 * @returns {Promise<boolean>}
 */
async function persistRouteSheetAddressGeo(addressKey, lat, lon, kmOffice) {
  if (!addressKey || !Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  try {
    const payload = {
      address_key: addressKey,
      lat,
      lon,
      km_office: kmOffice != null && Number.isFinite(kmOffice) ? kmOffice : null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabaseClient.from("route_sheet_address_geo").upsert(payload, {
      onConflict: "address_key",
    });
    if (error) {
      console.warn("route_sheet_address_geo upsert:", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("route_sheet_address_geo upsert:", e);
    return false;
  }
}

/**
 * Сохраняет вручную введённые (или найденные) координаты в справочник адрес→гео,
 * чтобы тот же адрес в других заказах ставился на карту без Nominatim.
 * @returns {Promise<boolean>}
 */
async function persistCoordinatesAttachedToAddress(displayAddr, lat, lon, kmOffice) {
  const dbKey = routeSheetGeoDbKeyFromDisplayAddress(displayAddr);
  if (!dbKey || !Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  rememberNominatimCoordsForAddress(displayAddr, { lat, lon });
  return persistRouteSheetAddressGeo(dbKey, lat, lon, kmOffice);
}

const ADDRESS_GEO_IN_CHUNK = 100;

/**
 * @param {string[]} addressKeys
 * @returns {Promise<Map<string, { lat: number, lon: number, km_office: number | null }>>}
 */
async function prefetchRouteSheetAddressGeoMap(addressKeys) {
  /** @type {Map<string, { lat: number, lon: number, km_office: number | null }>} */
  const map = new Map();
  const unique = [];
  const seen = new Set();
  for (const raw of addressKeys || []) {
    const k = String(raw ?? "").trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    unique.push(k);
  }
  for (let i = 0; i < unique.length; i += ADDRESS_GEO_IN_CHUNK) {
    const chunk = unique.slice(i, i + ADDRESS_GEO_IN_CHUNK);
    try {
      const { data, error } = await supabaseClient
        .from("route_sheet_address_geo")
        .select("address_key, lat, lon, km_office")
        .in("address_key", chunk);
      if (error) {
        console.warn("route_sheet_address_geo:", error.message);
        continue;
      }
      for (const row of data || []) {
        const parsed = parseRouteSheetAddressGeoRow(row);
        const key = String(row?.address_key ?? "").trim();
        if (!key || !parsed) continue;
        map.set(key, parsed);
      }
    } catch (e) {
      console.warn("route_sheet_address_geo:", e);
    }
  }
  return map;
}

/**
 * Подставляет координаты из справочника в заказы без своих координат (только в памяти).
 * Тогда точка попадает на карту, а колонка «км» считается по этим координатам.
 */
function applyAddressGeoCacheToOrders(orders, geoMap) {
  if (!orders?.length || !geoMap?.size) return;
  for (const o of orders) {
    if (!o || orderHasSavedCoordinates(o)) continue;
    if (isRouteSheetOfficeAddress(o.address)) continue;
    const k = routeSheetGeoDbKeyFromDisplayAddress(o.address);
    if (!k) continue;
    const cached = geoMap.get(k);
    if (!cached) continue;
    o.coordinates = formatCoordinatesForStorage(cached);
    rememberNominatimCoordsForAddress(o.address, { lat: cached.lat, lon: cached.lon });
  }
}

/** Строка для запроса к Nominatim и ключей кэша: часть до «//» (после часто пишут квартиру и т.п.). */
function addressForNominatimSearch(raw) {
  const t = String(raw).trim();
  if (!t) return "";
  const cut = t.indexOf("//");
  if (cut === -1) return t;
  return t.slice(0, cut).trim();
}

/** Запрос 1: только внутри города Волгоград (viewbox + bounded). */
function nominatimQueryCityPhase(address) {
  const t = String(address).trim();
  if (!t) return "";
  const lower = t.toLowerCase();
  if (lower.includes("волгоградск") && lower.includes("област")) return `${t}, Россия`;
  if (lower.includes("волгоград") && !lower.includes("област")) return `${t}, Россия`;
  return `${t}, город Волгоград, Россия`;
}

/** Запрос 2: область, если в городе не найдено. */
function nominatimQueryOblastPhase(address) {
  const t = String(address).trim();
  if (!t) return "";
  return `${t}, Волгоградская область, Россия`;
}

function coordsFromNominatimHit(hit) {
  if (!hit) return null;
  const lat = Number.parseFloat(hit.lat);
  const lon = Number.parseFloat(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

async function nominatimSearchRequest(params) {
  const url = `https://nominatim.openstreetmap.org/search?${params}`;
  const res = await fetch(url, { headers: { "Accept-Language": "ru,en" } });
  if (!res.ok) return null;
  const data = await res.json();
  return Array.isArray(data) ? data : null;
}

/**
 * Геокодирование (Nominatim): сначала строго в границах города Волгоград, иначе — в границах Волгоградской области.
 * Кэш с префиксом v4| — после смены логики старые значения не подхватываются.
 * @returns {Promise<{ lat: number, lon: number } | null>}
 */
async function geocodeAddressVolgograd(address) {
  const raw = String(address).trim();
  if (!raw) return null;
  const searchAddr = addressForNominatimSearch(raw);
  if (!searchAddr) return null;
  const key = geocodeNominatimCacheKey(searchAddr);
  if (nominatimCache.has(key)) return nominatimCache.get(key);

  const base = new URLSearchParams({ format: "json", limit: "1", countrycodes: "ru" });

  const cityParams = new URLSearchParams(base);
  cityParams.set("q", nominatimQueryCityPhase(searchAddr));
  cityParams.set("viewbox", NOMINATIM_VIEWBOX_VOLGOGRAD_CITY);
  cityParams.set("bounded", "1");

  let data = await nominatimSearchRequest(cityParams);
  let hit = data?.[0] ?? null;

  if (!hit) {
    await sleep(NOMINATIM_DELAY_MS);
    const oblastParams = new URLSearchParams(base);
    oblastParams.set("q", nominatimQueryOblastPhase(searchAddr));
    oblastParams.set("viewbox", NOMINATIM_VIEWBOX_VOLGOGRAD_OBLAST);
    oblastParams.set("bounded", "1");
    data = await nominatimSearchRequest(oblastParams);
    hit = data?.[0] ?? null;
  }

  const coords = coordsFromNominatimHit(hit);
  if (!coords) {
    nominatimCache.set(key, null);
    return null;
  }
  nominatimCache.set(key, coords);
  return coords;
}

function isRouteSheetOfficeAddress(raw) {
  return normalizeAddrForOfficeCompare(raw) === ROUTE_SHEET_OFFICE_ADDR_NORM;
}

function routeSheetOfficeLatLng(L) {
  return L.latLng(ROUTE_SHEET_OFFICE_LAT, ROUTE_SHEET_OFFICE_LON);
}

function addRouteSheetOfficeMarker(L) {
  if (!routeDeliveryOfficeLayer) return;
  const latlng = routeSheetOfficeLatLng(L);
  const html = `<div class="route-sheet-office-pin" role="img" aria-label="Главный офис">
    <div class="route-sheet-office-pin__flag">
      <svg class="route-sheet-office-pin__flag-svg" viewBox="0 0 28 18" width="22" height="14" aria-hidden="true" focusable="false">
        <path fill="#fef2f2" stroke="#b91c1c" stroke-width="1.1" d="M2 4 L14 1 L26 4 L26 17 L2 17 Z"/>
        <path fill="#fecaca" stroke="#991b1b" stroke-width="0.9" d="M8 17 L8 10 L12 7 L16 10 L16 17"/>
        <rect x="11" y="12" width="6" height="5" rx="0.5" fill="#fff" stroke="#b91c1c" stroke-width="0.8"/>
      </svg>
    </div>
    <div class="route-sheet-office-pin__pole" aria-hidden="true"></div>
    <div class="route-sheet-office-pin__dot" aria-hidden="true"></div>
  </div>`;
  const icon = L.divIcon({
    className: "route-sheet-map-divicon-root route-sheet-map-office-divicon",
    html,
    iconSize: [28, 42],
    iconAnchor: [14, 42],
    popupAnchor: [0, -44],
  });
  const m = L.marker(latlng, { icon, zIndexOffset: -200 });
  m.bindPopup(
    `<div class="route-sheet-map-popup-order"><strong>${escapeHtml(ROUTE_SHEET_OFFICE_ADDRESS)}</strong><br><span class="route-sheet-map-popup-addr">Волгоград</span></div>`,
  );
  m.on("popupopen", () => {
    if (routeDeliveryComposedRouteActive) return;
    invalidateRoadRouteDraw();
    clearRouteDeliveryRoadRouteLayer();
  });
  m.addTo(routeDeliveryOfficeLayer);
}

function ensureRouteDeliveryMap() {
  const L = globalThis.L;
  const el = document.getElementById("routeSheetDeliveryMap");
  if (!L || !el || routeDeliveryMap) return;

  routeDeliveryMap = L.map(el, {
    scrollWheelZoom: false,
    attributionControl: false,
    /** Canvas вместо SVG для линий — html2canvas меньше смещает маршрут относительно тайлов/маркеров. */
    preferCanvas: true,
  }).setView(VOLGOGRAD_CENTER, VOLGOGRAD_ZOOM_DEFAULT);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "",
    crossOrigin: true,
  }).addTo(routeDeliveryMap);
  routeDeliveryOfficeLayer = L.layerGroup().addTo(routeDeliveryMap);
  addRouteSheetOfficeMarker(L);
  routeDeliveryRouteLayer = L.layerGroup().addTo(routeDeliveryMap);
  routeDeliveryMarkersLayer = L.layerGroup().addTo(routeDeliveryMap);
}

function setRouteDeliveryMapStatus(text, warn) {
  const statusEl = document.getElementById("routeSheetDeliveryMapStatus");
  if (!statusEl) return;
  if (!text) {
    statusEl.textContent = "";
    statusEl.hidden = true;
    statusEl.classList.remove("route-sheet-map-status--warn");
    return;
  }
  statusEl.textContent = text;
  statusEl.hidden = false;
  statusEl.classList.toggle("route-sheet-map-status--warn", Boolean(warn));
}

function deliveryMapLabelText(ordersAtAddress) {
  return ordersAtAddress
    .map((o) => routeSheetOrderChipPlain(o))
    .filter(Boolean)
    .join(" · ");
}

function buildDeliveryPopupHtml(ordersAtAddress) {
  return ordersAtAddress
    .map((o) => {
      const num = escapeHtml(routeSheetOrderChipPlain(o) || "");
      const client = escapeHtml(o.client ?? "");
      const addr = escapeHtml(o.address ?? "");
      return `<div class="route-sheet-map-popup-order"><strong>${num}</strong> — ${client}<br><span class="route-sheet-map-popup-addr">${addr}</span></div>`;
    })
    .join("");
}

function deliveryMapMarkerIcon(L, ordersHere) {
  const labelRaw = deliveryMapLabelText(ordersHere);
  const labelHtml = escapeHtml(labelRaw || "—");
  const html = `<div class="route-sheet-map-marker"><span class="route-sheet-map-marker-dot" aria-hidden="true"></span><span class="route-sheet-map-marker-label">${labelHtml}</span></div>`;
  const approxW = Math.min(280, 22 + Math.max(56, labelRaw.length * 7.5));
  return L.divIcon({
    className: "route-sheet-map-divicon-root",
    html,
    iconSize: [approxW, 26],
    iconAnchor: [8, 13],
    popupAnchor: [0, -12],
  });
}

function deliveryMapMarkerIconNumbered(L, ordersHere, sequenceNum) {
  const labelRaw = deliveryMapLabelText(ordersHere);
  const labelHtml = escapeHtml(labelRaw || "—");
  const seqStr = escapeHtml(String(sequenceNum));
  const html = `<div class="route-sheet-map-marker route-sheet-map-marker--route-seq"><span class="route-sheet-map-marker-seq">${seqStr}</span><span class="route-sheet-map-marker-label">${labelHtml}</span></div>`;
  const approxW = Math.min(280, 28 + Math.max(56, labelRaw.length * 7.5));
  return L.divIcon({
    className: "route-sheet-map-divicon-root",
    html,
    iconSize: [approxW, 26],
    iconAnchor: [8, 13],
    popupAnchor: [0, -12],
  });
}

function scheduleInvalidateRouteDeliveryMap() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      routeDeliveryMap?.invalidateSize();
    });
  });
}

/**
 * По очереди для каждого уникального адреса: геокод → маркер на карте → км в таблице (OSRM офис → точка).
 * Один проход устраняет гонки Nominatim/OSRM между картой и колонкой «км».
 * @param {Array<object>} deliveryRows
 * @param {number} gen
 */
async function runDeliveryPipeline(deliveryRows, gen) {
  try {
    await ensureLeaflet();
  } catch (e) {
    console.error(e);
    setRouteDeliveryMapStatus("Карта: не удалось загрузить библиотеку. Обновите страницу.", true);
    return;
  }

  const L = globalThis.L;
  if (!L) {
    setRouteDeliveryMapStatus("Карта: библиотека не загружена. Обновите страницу.", true);
    return;
  }

  try {
    ensureRouteDeliveryMap();
    if (!routeDeliveryMap || !routeDeliveryMarkersLayer) return;
    if (gen !== routeDeliveryPipelineGeneration) return;

    routeDeliveryComposeGeneration += 1;
    clearRouteDeliveryMarkersAndRoadRoute();
    deliveryKmByOrderId.clear();

    const geoKeys = deliveryRows
      .map((o) => routeSheetGeoDbKeyFromDisplayAddress(o?.address))
      .filter(Boolean);
    const addressGeoMap = await prefetchRouteSheetAddressGeoMap(geoKeys);
    if (gen !== routeDeliveryPipelineGeneration) return;
    applyAddressGeoCacheToOrders(deliveryRows, addressGeoMap);

    const noGeoOrders = deliveryRows.filter((o) => deliveryPipelineGroupKey(o) === "");
    for (const o of noGeoOrders) deliveryKmByOrderId.set(o.id, /** @type {null} */ (null));
    updateKmCellsForOrders(noGeoOrders);
    syncRouteSheetDeliveryAddressRecognition(noGeoOrders, false);

    const withGeo = deliveryRows.filter((o) => deliveryPipelineGroupKey(o) !== "");
    if (withGeo.length === 0) {
      routeDeliveryMap.setView(VOLGOGRAD_CENTER, VOLGOGRAD_ZOOM_DEFAULT);
      setRouteDeliveryMapStatus("");
      scheduleInvalidateRouteDeliveryMap();
      return;
    }

    const officeLL = routeSheetOfficeLatLng(L);
    const withAddrForMap = withGeo.filter(
      (o) => orderHasSavedCoordinates(o) || !isRouteSheetOfficeAddress(o.address),
    );

    /** @type {Map<string, object[]>} */
    const byGroup = new Map();
    for (const o of withGeo) {
      const k = deliveryPipelineGroupKey(o);
      if (!byGroup.has(k)) byGroup.set(k, []);
      byGroup.get(k).push(o);
    }

    const orderedKeys = [];
    const keySeen = new Set();
    for (const o of deliveryRows) {
      const k = deliveryPipelineGroupKey(o);
      if (k === "" || keySeen.has(k)) continue;
      keySeen.add(k);
      orderedKeys.push(k);
    }
    const Y = orderedKeys.length;
    const failedGeocode = [];
    const failedOsrm = [];
    const latLngs = [];

    if (withAddrForMap.length === 0) {
      for (const o of withGeo) {
        if (isRouteSheetOfficeAddress(o.address)) {
          deliveryKmByOrderId.set(o.id, makeDeliveryKmEntry(0, ROUTE_SHEET_OFFICE_LAT));
        } else deliveryKmByOrderId.set(o.id, null);
      }
      updateKmCellsForOrders(withGeo);
      syncRouteSheetDeliveryAddressRecognition(
        withGeo.filter((o) => isRouteSheetOfficeAddress(o.address)),
        true,
      );
      syncRouteSheetDeliveryAddressRecognition(
        withGeo.filter((o) => !isRouteSheetOfficeAddress(o.address)),
        false,
      );
      routeDeliveryMap.setView(officeLL, 15);
      setRouteDeliveryMapStatus("");
      scheduleInvalidateRouteDeliveryMap();
      return;
    }

    for (let i = 0; i < orderedKeys.length; i++) {
      if (gen !== routeDeliveryPipelineGeneration) return;
      const key = orderedKeys[i];
      const ordersHere = byGroup.get(key) || [];
      const first = ordersHere[0];
      const coordParsed = parseLatLonCommaInput(first?.coordinates);
      const displayAddr = (first?.address ?? "").trim();
      const x = i + 1;

      if (coordParsed) {
        setRouteDeliveryMapStatus(`Точка ${x} из ${Y}: координаты`, false);
        const coords = { lat: coordParsed.lat, lon: coordParsed.lon };
        const latlng = L.latLng(coords.lat, coords.lon);
        latLngs.push(latlng);
        try {
          const marker = L.marker(latlng, {
            icon: deliveryMapMarkerIcon(L, ordersHere),
          });
          marker.bindPopup(buildDeliveryPopupHtml(ordersHere));
          bindDeliveryMarkerPopupOpenRoute(marker);
          marker.addTo(routeDeliveryMarkersLayer);
          if (isStopFarFromOfficeLatLon(coords.lat, coords.lon)) {
            routeDeliveryTripStops.push({ lat: coords.lat, lon: coords.lon, ordersHere });
          }
        } catch (e) {
          console.error("Leaflet marker:", e);
          setRouteDeliveryMapStatus(`Ошибка отображения точки (${x} из ${Y}).`, true);
        }

        let km = null;
        let fromDbFull = false;
        const dbKey = routeSheetGeoDbKeyFromDisplayAddress(displayAddr);
        const cachedGeo = dbKey ? addressGeoMap.get(dbKey) : null;
        if (coordsMatchCachedGeo(coords, cachedGeo) && cachedGeo.km_office != null) {
          km = cachedGeo.km_office;
          fromDbFull = true;
        }
        if (km == null) {
          try {
            km = await osrmDrivingDistanceKm(
              ROUTE_SHEET_OFFICE_LON,
              ROUTE_SHEET_OFFICE_LAT,
              coords.lon,
              coords.lat,
            );
          } catch (e) {
            console.error("OSRM:", e);
            setRouteDeliveryMapStatus(`Ошибка маршрута км (${x} из ${Y}).`, true);
          }
        }
        if (gen !== routeDeliveryPipelineGeneration) return;
        if (km == null) failedOsrm.push(displayAddr || "координаты");
        const kmEntry = makeDeliveryKmEntry(km, coords.lat);
        for (const o of ordersHere) deliveryKmByOrderId.set(o.id, kmEntry);
        updateKmCellsForOrders(ordersHere);
        syncRouteSheetDeliveryAddressRecognition(ordersHere, true);
        if (dbKey && !fromDbFull) {
          void persistCoordinatesAttachedToAddress(displayAddr, coords.lat, coords.lon, km).then((ok) => {
            if (!ok) return;
            addressGeoMap.set(dbKey, {
              lat: coords.lat,
              lon: coords.lon,
              km_office: km != null && Number.isFinite(km) ? km : null,
            });
          });
        }
        if (i < orderedKeys.length - 1 && !fromDbFull) await sleep(250);
        continue;
      }

      setRouteDeliveryMapStatus(`Ищем адрес ${x} из ${Y}: ${truncateForStatus(displayAddr, 72)}`, false);

      if (isRouteSheetOfficeAddress(displayAddr)) {
        for (const o of ordersHere) {
          deliveryKmByOrderId.set(o.id, makeDeliveryKmEntry(0, ROUTE_SHEET_OFFICE_LAT));
        }
        updateKmCellsForOrders(ordersHere);
        syncRouteSheetDeliveryAddressRecognition(ordersHere, true);
        latLngs.push(officeLL);
        if (i < orderedKeys.length - 1) await sleep(NOMINATIM_DELAY_MS);
        continue;
      }

      let coords = null;
      let km = null;
      const dbKey = routeSheetGeoDbKeyFromDisplayAddress(displayAddr);
      let fromDbFull = false;

      if (dbKey) {
        let cached = addressGeoMap.get(dbKey) || null;
        if (!cached) {
          cached = await fetchRouteSheetAddressGeoFromDb(dbKey);
          if (cached) addressGeoMap.set(dbKey, cached);
        }
        if (gen !== routeDeliveryPipelineGeneration) return;
        if (cached) {
          coords = { lat: cached.lat, lon: cached.lon };
          rememberNominatimCoordsForAddress(displayAddr, coords);
          if (cached.km_office != null) {
            km = cached.km_office;
            fromDbFull = true;
          }
        }
      }

      if (!coords) {
        try {
          coords = await geocodeAddressVolgograd(displayAddr);
        } catch (e) {
          console.error("Nominatim:", e);
          setRouteDeliveryMapStatus(
            `Ошибка сети (${x} из ${Y}): запрос адреса. ${truncateForStatus(displayAddr, 56)}`,
            true,
          );
        }
      }
      if (gen !== routeDeliveryPipelineGeneration) return;

      if (!coords) {
        failedGeocode.push(displayAddr);
        for (const o of ordersHere) deliveryKmByOrderId.set(o.id, /** @type {null} */ (null));
        updateKmCellsForOrders(ordersHere);
        syncRouteSheetDeliveryAddressRecognition(ordersHere, false);
        if (i < orderedKeys.length - 1) await sleep(NOMINATIM_DELAY_MS);
        continue;
      }

      const latlng = L.latLng(coords.lat, coords.lon);
      latLngs.push(latlng);
      try {
        const marker = L.marker(latlng, {
          icon: deliveryMapMarkerIcon(L, ordersHere),
        });
        marker.bindPopup(buildDeliveryPopupHtml(ordersHere));
        bindDeliveryMarkerPopupOpenRoute(marker);
        marker.addTo(routeDeliveryMarkersLayer);
        if (isStopFarFromOfficeLatLon(coords.lat, coords.lon)) {
          routeDeliveryTripStops.push({ lat: coords.lat, lon: coords.lon, ordersHere });
        }
      } catch (e) {
        console.error("Leaflet marker:", e);
        setRouteDeliveryMapStatus(`Ошибка отображения точки (${x} из ${Y}).`, true);
      }

      if (km == null) {
        try {
          km = await osrmDrivingDistanceKm(
            ROUTE_SHEET_OFFICE_LON,
            ROUTE_SHEET_OFFICE_LAT,
            coords.lon,
            coords.lat,
          );
        } catch (e) {
          console.error("OSRM:", e);
          setRouteDeliveryMapStatus(`Ошибка маршрута км (${x} из ${Y}).`, true);
        }
      }
      if (gen !== routeDeliveryPipelineGeneration) return;
      if (km == null) failedOsrm.push(displayAddr);
      const kmEntryAddr = makeDeliveryKmEntry(km, coords.lat);
      for (const o of ordersHere) deliveryKmByOrderId.set(o.id, kmEntryAddr);
      updateKmCellsForOrders(ordersHere);
      syncRouteSheetDeliveryAddressRecognition(ordersHere, true);

      if (dbKey && !fromDbFull) {
        void persistCoordinatesAttachedToAddress(displayAddr, coords.lat, coords.lon, km).then((ok) => {
          if (!ok) return;
          addressGeoMap.set(dbKey, {
            lat: coords.lat,
            lon: coords.lon,
            km_office: km != null && Number.isFinite(km) ? km : null,
          });
        });
      }

      if (i < orderedKeys.length - 1 && !fromDbFull) await sleep(NOMINATIM_DELAY_MS);
    }

    if (gen !== routeDeliveryPipelineGeneration) return;

    if (latLngs.length === 1) {
      routeDeliveryMap.fitBounds(L.latLngBounds([latLngs[0], officeLL]), { padding: [36, 36], maxZoom: 15 });
    } else if (latLngs.length > 1) {
      const b = L.latLngBounds(latLngs);
      b.extend(officeLL);
      routeDeliveryMap.fitBounds(b, { padding: [28, 28], maxZoom: 15 });
    } else {
      routeDeliveryMap.setView(VOLGOGRAD_CENTER, VOLGOGRAD_ZOOM_DEFAULT);
    }

    const parts = [];
    if (failedGeocode.length) {
      parts.push(
        `не найдено на карте (${failedGeocode.length}): ${truncateForStatus(failedGeocode.slice(0, 2).join("; "), 100)}`,
      );
    }
    if (failedOsrm.length) {
      parts.push(`км по маршруту не получены (${failedOsrm.length} адр.)`);
    }
    if (parts.length) {
      setRouteDeliveryMapStatus(`Обработка завершена. ${parts.join(" ")}`, true);
    } else {
      setRouteDeliveryMapStatus("");
    }
    scheduleInvalidateRouteDeliveryMap();
  } catch (e) {
    console.error("runDeliveryPipeline:", e);
    setRouteDeliveryMapStatus(
      `Сбой: ${e instanceof Error ? truncateForStatus(e.message, 140) : "неизвестная ошибка"}. Попробуйте обновить страницу или сузить период.`,
      true,
    );
    scheduleInvalidateRouteDeliveryMap();
  }
}

/**
 * На маршрутном листе в «Доставка» user_lite видит строки типа «Магазин»,
 * но открытие/редактирование карточки заказа для них остаётся закрытым.
 */
function ordersVisibleOnRouteSheet({ includeShopForUserLite = false } = {}) {
  return (state.allOrders || []).filter((o) => {
    if (isUserShop()) return true;
    if (!isOrderHiddenForCurrentRole(o)) return true;
    return includeShopForUserLite && isShopType(o);
  });
}

/**
 * Найти заказ по вводу «Точка по номеру»: только цифры (id) или полный номер, как в таблице заказов.
 * Id ≥ 1000 отображаются без ведущего нуля (1113_О), id < 1000 — с padStart(4) (0112_О);
 * сравнение чипа допускает лишние/отсутствующие ведущие нули в цифровой части.
 */
function findOrderByRouteSheetNumberInput(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const orders = ordersVisibleOnRouteSheet({ includeShopForUserLite: true });

  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    if (!Number.isFinite(n)) return null;
    return orders.find((o) => Number(o.id) === n) ?? null;
  }

  const norm = s.replace(/\s+/g, "");
  const normLower = norm.toLowerCase();
  for (const o of orders) {
    const chip = formatOrderIdTypeChip(o.id, o.order_type);
    if (!chip) continue;
    if (chip.replace(/\s+/g, "").toLowerCase() === normLower) return o;
  }

  // «01113_О» / «1113_О» / «1113_окна» — id без учёта ведущих нулей + буква/тип
  const m = norm.match(/^0*(\d+)[_.,\-]*(.*)$/u);
  if (m) {
    const n = parseInt(m[1], 10);
    const suffix = (m[2] || "").trim();
    if (Number.isFinite(n)) {
      const found = orders.find((o) => {
        if (Number(o.id) !== n) return false;
        if (!suffix) return true;
        const type = (o.order_type || "").trim();
        const letter = type.charAt(0);
        if (!letter) return false;
        const sufLower = suffix.toLowerCase();
        return letter.toLowerCase() === sufLower.charAt(0) || type.toLowerCase() === sufLower;
      });
      if (found) return found;
    }
  }

  return null;
}

/** Подсказка при наведении на обрезанный адрес — как в `renderOrders` для `td.td-order-address`. */
function syncRouteSheetDeliveryAddressTitles() {
  const tbody = document.querySelector("#routeSheetTableDelivery tbody");
  if (!tbody) return;
  tbody.querySelectorAll("td.td-order-address").forEach((cell) => {
    const full = cell.getAttribute("data-fulltext");
    if (!full) return;
    const chip = cell.querySelector(".status-value");
    const truncated =
      chip && chip.scrollWidth > chip.clientWidth + 0.5
        ? true
        : cell.scrollWidth > cell.clientWidth + 0.5;
    if (truncated) cell.setAttribute("title", full);
    else cell.removeAttribute("title");
  });
}

/**
 * @param {object} order
 * @param {string} [kmDisplay] если передано — колонка «км» (таблица «Доставка»); иначе без колонки («Самовывоз»).
 * @param {{ includeShipDate?: boolean, includeRemainder?: boolean, includeAddressGeoBtn?: boolean, routePointNum?: number | null }} [opts] «Дата», «Остаток», адрес как в «Заказах» — только «Доставка».
 */
function rowMainHtml(order, kmDisplay, opts = {}) {
  const {
    includeShipDate = false,
    includeRemainder = false,
    includeAddressGeoBtn = false,
    routePointNum = null,
  } = opts;
  const mosk =
    order.area_m2 != null && order.area_m2 !== "" ? escapeHtml(String(order.area_m2)) : "";
  const konst =
    order.construction_count != null && order.construction_count !== ""
      ? escapeHtml(String(order.construction_count))
      : "";
  const kmTd =
    kmDisplay === undefined
      ? ""
      : `<td class="route-sheet-col-km" data-order-id="${order.id ?? ""}"><span class="status-value">${escapeHtml(String(kmDisplay))}</span></td>`;
  const dateTd = includeShipDate
    ? `<td class="route-sheet-col-date">${escapeHtml(formatDateShortRU(order.delivery_date))}</td>`
    : "";
  const remainderShowAmount =
    boolDaNet(order.installation) !== "да" &&
    !isOrderPaid(order) &&
    order.remaining_amount != null &&
    order.remaining_amount !== "";
  const remainderTd = includeRemainder
    ? remainderShowAmount
      ? `<td class="route-sheet-col-remainder">${escapeHtml(formatAmount(order.remaining_amount))}</td>`
      : `<td class="route-sheet-col-remainder">${escapeHtml("-")}</td>`
    : "";
  const clientPlain = order.client ?? "";
  const clientTd = includeShipDate
    ? `<td class="route-sheet-delivery-client"><span class="route-sheet-delivery-clamp-inner" data-fulltext="${escapeAttr(String(clientPlain))}"${ROUTE_SHEET_DELIVERY_CLAMP_ACTIVABLE}>${escapeHtml(clientPlain)}</span></td>`
    : `<td>${escapeHtml(clientPlain)}</td>`;
  const addressTd = includeAddressGeoBtn
    ? deliveryAddressCellHtml(order)
    : `<td>${escapeHtml(order.address ?? "")}</td>`;
  let descriptionTd;
  if (includeShipDate) {
    const descDeliveryPlain = routeSheetDeliveryDescriptionFullPlain(order);
    descriptionTd = `<td class="route-sheet-delivery-description"><span class="route-sheet-delivery-clamp-inner" data-fulltext="${escapeAttr(String(descDeliveryPlain))}"${ROUTE_SHEET_DELIVERY_CLAMP_ACTIVABLE}>${escapeHtml(descDeliveryPlain)}</span></td>`;
  } else {
    descriptionTd = `<td>${escapeHtml(order.description ?? "")}</td>`;
  }
  const hiddenExtra = includeShipDate ? ' class="route-sheet-col-delivery-hidden"' : "";
  const selectTd = includeShipDate ? routeSelectCellHtml(order, { routePointNum }) : "";
  return `<tr>
    ${selectTd}
    ${orderIdCellHtml(order)}
    ${dateTd}
    ${clientTd}
    ${addressTd}
    ${kmTd}
    ${descriptionTd}
    ${remainderTd}
    <td${hiddenExtra}>${mosk}</td>
    <td${hiddenExtra}>${konst}</td>
    <td${hiddenExtra}>${escapeHtml(boolDaNet(order.installation))}</td>
    <td${hiddenExtra}>${escapeHtml(boolDaNet(order.reveals))}</td>
    <td class="route-sheet-col-phone">${escapeHtml(order.phone ?? "")}</td>
  </tr>`;
}

export function loadRouteSheet() {
  const msgEl = document.getElementById("routeSheetMessage");
  const tbodyDelivery = document.querySelector("#routeSheetTableDelivery tbody");
  const tbodyPickup = document.querySelector("#routeSheetTablePickup tbody");
  if (!tbodyDelivery || !tbodyPickup) return;

  closeOrderIdActionsMenu();

  const { fromKey, toKey, valid } = getRangeFromDom();
  if (!valid) {
    if (msgEl) msgEl.textContent = "Укажите даты «с» и «по» в формате ГГГГ-ММ-ДД.";
    tbodyDelivery.innerHTML = "";
    tbodyPickup.innerHTML = "";
    routeDeliveryPipelineGeneration += 1;
    routeDeliveryComposeGeneration += 1;
    deliveryKmByOrderId.clear();
    clearRouteDeliveryMarkersAndRoadRoute();
    setRouteDeliveryMapStatus("");
    return;
  }
  if (fromKey > toKey) {
    if (msgEl) msgEl.textContent = "Дата «с» не может быть позже даты «по».";
    tbodyDelivery.innerHTML = "";
    tbodyPickup.innerHTML = "";
    routeDeliveryPipelineGeneration += 1;
    routeDeliveryComposeGeneration += 1;
    deliveryKmByOrderId.clear();
    clearRouteDeliveryMarkersAndRoadRoute();
    setRouteDeliveryMapStatus("");
    return;
  }

  if (msgEl) msgEl.textContent = "";

  const orders = ordersVisibleOnRouteSheet({ includeShopForUserLite: true });
  const deliveryFromDb = filterRouteSheetDeliveryOrdersByShipment(
    orders,
    fromKey,
    toKey,
    DELIVERY_SHIP,
  );
  const deliveryManual = manualDeliveryOrdersInRange(fromKey, toKey);
  const deliveryRows = deliveryFromDb.concat(deliveryManual);
  const pickupRows = filterMainOrdersByShipment(orders, fromKey, toKey, DELIVERY_PICKUP);

  tbodyPickup.innerHTML = pickupRows.map((o) => rowMainHtml(o)).join("");

  if (isRouteSheetSectionActive()) {
    const gen = ++routeDeliveryPipelineGeneration;
    tbodyDelivery.innerHTML = deliveryRows
      .map((o) =>
        rowMainHtml(o, "…", {
          includeShipDate: true,
          includeRemainder: true,
          includeAddressGeoBtn: true,
        }),
      )
      .join("");
    syncRouteSheetDeliveryAddressTitles();
    void runDeliveryPipeline(deliveryRows, gen);
  } else {
    routeDeliveryPipelineGeneration += 1;
    routeDeliveryComposeGeneration += 1;
    deliveryKmByOrderId.clear();
    clearRouteDeliveryMarkersAndRoadRoute();
    tbodyDelivery.innerHTML = deliveryRows
      .map((o) =>
        rowMainHtml(o, "—", {
          includeShipDate: true,
          includeRemainder: true,
          includeAddressGeoBtn: true,
        }),
      )
      .join("");
    syncRouteSheetDeliveryAddressTitles();
  }
}

function excelFileNameTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

/**
 * Дата МЛ и ФИО водителя с формы маршрутного листа (над кнопкой выгрузки).
 * @returns {{ mlDateKey: string, driverName: string }}
 */
function getRouteSheetMlMetaFromDom() {
  const mlDateEl = document.getElementById("routeSheetMlDate");
  const driverEl = document.getElementById("routeSheetDriver");
  const mlDateKey = String(mlDateEl?.value ?? "").trim();
  const driverName = String(driverEl?.value ?? "")
    .trim()
    .replace(/\s+/g, " ");
  return { mlDateKey, driverName };
}

/**
 * «Маршрутный лист на 3 августа 2026» по YYYY-MM-DD (локальная дата, без сдвига UTC).
 * @param {string} isoYmd
 */
function formatRouteSheetMlTitleDate(isoYmd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoYmd || "").trim());
  if (!m) return "";
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return "";
  const monthName = ROUTE_SHEET_ML_MONTHS_GENITIVE[month - 1];
  return `${day} ${monthName} ${year}`;
}

/**
 * Две строки над таблицей Excel «Доставка»: заголовок с датой МЛ и «Водитель:» + ФИО.
 * @returns {string[][]}
 */
function buildRouteSheetDeliveryExcelPreamble() {
  const { mlDateKey, driverName } = getRouteSheetMlMetaFromDom();
  const datePart = formatRouteSheetMlTitleDate(mlDateKey);
  const title = datePart ? `Маршрутный лист на ${datePart}` : "Маршрутный лист";
  const driverLine = driverName ? `Водитель: ${driverName}` : "Водитель:";
  return [[title], [driverLine]];
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

/** Узкие столбцы для выгрузки «Доставка» через SheetJS (без стилей переноса в community-формате). */
function applyDeliveryPrintColumnWidthsXlsx(ws, numCols) {
  const w = ROUTE_SHEET_DELIVERY_EXCEL_COL_WIDTHS;
  const cols = [];
  for (let c = 0; c < numCols; c++) {
    cols.push({ wch: w[c] ?? 8 });
  }
  ws["!cols"] = cols;
}

/**
 * Поля страницы Excel «Доставка» (дюймы) — должны совпадать с pageSetup ниже.
 * A4 книжная: ширина таблицы = ширина листа; карта занимает оставшуюся высоту.
 */
const ROUTE_SHEET_EXCEL_PAGE = {
  paperWidthIn: 210 / 25.4,
  paperHeightIn: 297 / 25.4,
  marginLeftIn: 0.25,
  marginRightIn: 0.25,
  marginTopIn: 0.55,
  marginBottomIn: 0.55,
  dpi: 96,
};

/** Высота строки-заглушки под карту в пунктах Excel (1 pt = 1/72"). */
const ROUTE_SHEET_EXCEL_MAP_ROW_HEIGHT_PT = 15;

/**
 * Кегль текста таблицы «Доставка» в Excel.
 */
const ROUTE_SHEET_EXCEL_DATA_FONT_SIZE = 9;

/**
 * Стандартная высота одной текстовой линии в строке Excel (пункты).
 * Default Row Height Excel: 1→15, 2→30, 3→45, 4→60.
 */
const ROUTE_SHEET_EXCEL_LINE_HEIGHT_PT = 15;

/**
 * Горизонтальные поля ячейки (px @ 96dpi) при soft-wrap.
 * 2px: тонкая рамка; больший pad раньше обрезал первую линию
 * («Остаток»→«Остато/к», «км» уезжал на следующую строку).
 */
const ROUTE_SHEET_EXCEL_CELL_PAD_X_PX = 2;

/** Минимальная высота области карты на листе (px @ 96 dpi). */
const ROUTE_SHEET_EXCEL_MAP_MIN_HEIGHT_PX = 200;

/**
 * Ширина столбца Excel (wch) → пиксели при MDW=7 (Calibri 11).
 * @param {number} wch
 */
function excelColWidthToPx(wch) {
  const w = Number(wch) || 0;
  if (w <= 0) return 0;
  return Math.floor(((256 * w + Math.floor(128 / 7)) / 256) * 7);
}

/** Суммарная ширина таблицы «Доставка» в пикселях (задаёт ширину листа). */
function routeSheetDeliveryTableWidthPx() {
  return ROUTE_SHEET_DELIVERY_EXCEL_COL_WIDTHS.reduce((sum, w) => sum + excelColWidthToPx(w), 0);
}

function routeSheetExcelPointsToPx(pt) {
  return (Number(pt) || 0) * (ROUTE_SHEET_EXCEL_PAGE.dpi / 72);
}

/** Печатная область A4 книжная с учётом полей pageSetup. */
function routeSheetExcelPrintablePx() {
  const p = ROUTE_SHEET_EXCEL_PAGE;
  return {
    width: Math.round((p.paperWidthIn - p.marginLeftIn - p.marginRightIn) * p.dpi),
    height: Math.round((p.paperHeightIn - p.marginTopIn - p.marginBottomIn) * p.dpi),
  };
}

/**
 * Текст ячейки Excel без хвостовых пустых строк (и пробелов по краям).
 * Сохраняет внутренние переносы (имя/телефон, многострочное описание).
 * @param {unknown} text
 */
function normalizeExcelMultilineText(text) {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n+$/g, "")
    .replace(/^\n+/g, "")
    .trimEnd();
}

/**
 * Доли em ширины глифа Calibri (метрики Carlito ≈ Calibri, +2% запас).
 * Точные значения для частых символов — иначе средние по классу
 * завышали ширину и soft-wrap переносил строку слишком рано.
 */
const ROUTE_SHEET_CALIBRI_ADV_EM = {
  " ": 0.2306,
  "0": 0.517,
  "1": 0.517,
  "2": 0.517,
  "3": 0.517,
  "4": 0.517,
  "5": 0.517,
  "6": 0.517,
  "7": 0.517,
  "8": 0.517,
  "9": 0.517,
  ".": 0.2575,
  ",": 0.2545,
  ";": 0.2729,
  ":": 0.2729,
  "!": 0.3322,
  "?": 0.4726,
  "/": 0.394,
  "-": 0.3123,
  "—": 0.9234,
  "(": 0.3093,
  ")": 0.3093,
  "[": 0.3128,
  "]": 0.3128,
  "«": 0.5225,
  "»": 0.5225,
  "№": 1.0454,
  "%": 0.7291,
  "+": 0.508,
  "*": 0.508,
  "=": 0.508,
  "°": 0.3456,
  "²": 0.3427,
  А: 0.5902,
  Б: 0.5483,
  В: 0.5548,
  Г: 0.4383,
  Д: 0.6569,
  Е: 0.498,
  Ё: 0.498,
  Ж: 0.8168,
  З: 0.4831,
  И: 0.6544,
  Й: 0.6544,
  К: 0.5538,
  Л: 0.6231,
  М: 0.8721,
  Н: 0.6355,
  О: 0.6754,
  П: 0.634,
  Р: 0.5269,
  С: 0.5439,
  Т: 0.4971,
  У: 0.5379,
  Ф: 0.7112,
  Х: 0.5294,
  Ц: 0.6514,
  Ч: 0.5668,
  Ш: 0.8855,
  Щ: 0.9074,
  Ъ: 0.627,
  Ы: 0.777,
  Ь: 0.5419,
  Э: 0.5588,
  Ю: 0.8965,
  Я: 0.5663,
  а: 0.4886,
  б: 0.5434,
  в: 0.4886,
  г: 0.3526,
  д: 0.5693,
  е: 0.5075,
  ё: 0.5075,
  ж: 0.7027,
  з: 0.4313,
  и: 0.5513,
  й: 0.5513,
  к: 0.4731,
  л: 0.5205,
  м: 0.6898,
  н: 0.5454,
  о: 0.5379,
  п: 0.5309,
  р: 0.5359,
  с: 0.4313,
  т: 0.395,
  у: 0.4617,
  ф: 0.6365,
  х: 0.4418,
  ц: 0.5523,
  ч: 0.4781,
  ш: 0.7431,
  щ: 0.764,
  ъ: 0.5469,
  ы: 0.6793,
  ь: 0.4791,
  э: 0.4517,
  ю: 0.7361,
  я: 0.4836,
};

/**
 * Ширина текста как у Calibri в Excel (px @ 96dpi).
 * Сначала таблица глифов, иначе — средние по классу (Carlito +2%).
 * @param {string} text
 * @param {number} fontSizePt
 */
function measureCalibriApproxWidthPx(text, fontSizePt) {
  const em = fontSizePt * (96 / 72);
  const advMap = ROUTE_SHEET_CALIBRI_ADV_EM;
  let w = 0;
  for (const ch of String(text)) {
    const known = advMap[ch];
    if (known != null) {
      w += em * known;
      continue;
    }
    const code = ch.codePointAt(0) || 0;
    if (code >= 0x0410 && code <= 0x042f) w += em * 0.628;
    else if ((code >= 0x0430 && code <= 0x044f) || code === 0x0451) w += em * 0.54;
    else if (code >= 0x0400 && code <= 0x04ff) w += em * 0.56;
    else if (code >= 0x41 && code <= 0x5a) w += em * 0.565;
    else if (code >= 0x61 && code <= 0x7a) w += em * 0.465;
    else if (ch >= "0" && ch <= "9") w += em * 0.517;
    else w += em * 0.55;
  }
  return w;
}

/**
 * @param {string} text
 * @param {number} fontSizePt
 */
function measureExcelTextWidthPx(text, fontSizePt) {
  return measureCalibriApproxWidthPx(text, fontSizePt);
}

/**
 * Разбить один абзац на линии по ширине колонки (явные переносы).
 * @param {string} paragraph
 * @param {number} maxWidthPx
 * @param {number} fontSizePt
 * @returns {string[]}
 */
function softWrapExcelParagraphLines(paragraph, maxWidthPx, fontSizePt) {
  const words = String(paragraph || "")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return [];
  const spaceW = measureExcelTextWidthPx(" ", fontSizePt);
  /** @type {string[]} */
  const lines = [];
  let cur = "";
  let curW = 0;

  const pushHardWrappedWord = (word) => {
    let chunk = "";
    for (const ch of word) {
      const next = chunk + ch;
      if (chunk && measureExcelTextWidthPx(next, fontSizePt) > maxWidthPx) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk = next;
      }
    }
    if (chunk) {
      cur = chunk;
      curW = measureExcelTextWidthPx(chunk, fontSizePt);
    } else {
      cur = "";
      curW = 0;
    }
  };

  for (const word of words) {
    const wordW = measureExcelTextWidthPx(word, fontSizePt);
    if (wordW > maxWidthPx) {
      if (cur) {
        lines.push(cur);
        cur = "";
        curW = 0;
      }
      pushHardWrappedWord(word);
      continue;
    }
    if (!cur) {
      cur = word;
      curW = wordW;
    } else if (curW + spaceW + wordW <= maxWidthPx) {
      cur = `${cur} ${word}`;
      curW += spaceW + wordW;
    } else {
      lines.push(cur);
      cur = word;
      curW = wordW;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Вставить явные `\n` там, где текст не помещается в ширину колонки.
 * Высота строки тогда = 15pt × число этих линий — без угадывания wrapText Excel.
 * @param {unknown} text
 * @param {number} colWidthChars
 * @param {number} [fontSizePt]
 */
function softWrapExcelText(text, colWidthChars, fontSizePt = ROUTE_SHEET_EXCEL_DATA_FONT_SIZE) {
  const t = normalizeExcelMultilineText(text);
  if (!t) return "";
  const maxWidthPx = Math.max(8, excelColWidthToPx(colWidthChars) - ROUTE_SHEET_EXCEL_CELL_PAD_X_PX);
  return t
    .split("\n")
    .map((part) => softWrapExcelParagraphLines(part, maxWidthPx, fontSizePt).join("\n"))
    .join("\n");
}

/**
 * Число явных линий в тексте ячейки (после softWrap / `\n`).
 * @param {unknown} text
 */
function countExcelExplicitLines(text) {
  const t = normalizeExcelMultilineText(text);
  if (!t) return 1;
  return t.split("\n").length;
}

/**
 * Подготовить строку таблицы «Доставка»: soft-wrap по ширине каждого столбца.
 * @param {unknown[]} values
 * @param {number[]} [colWidths]
 * @param {number} [fontSizePt]
 */
function prepareDeliveryExcelRow(values, colWidths = ROUTE_SHEET_DELIVERY_EXCEL_COL_WIDTHS, fontSizePt = ROUTE_SHEET_EXCEL_DATA_FONT_SIZE) {
  const row = Array.isArray(values) ? values : [];
  return row.map((v, i) => {
    if (v == null || v === "") return v ?? "";
    if (typeof v === "number") return v;
    return softWrapExcelText(String(v), colWidths[i] ?? colWidths[0] ?? 8, fontSizePt);
  });
}

/**
 * Высота строки Excel: 15pt × max явных линий по столбцам (после soft-wrap).
 * @param {unknown[]} values
 * @param {number[]} colWidths
 * @param {{ fontSize?: number, lineHeightPt?: number, maxLines?: number }} [opts]
 */
function estimateExcelRowHeightPt(values, colWidths, opts = {}) {
  const fontSize = opts.fontSize || ROUTE_SHEET_EXCEL_DATA_FONT_SIZE;
  const lineHeightPt = opts.lineHeightPt || ROUTE_SHEET_EXCEL_LINE_HEIGHT_PT;
  const maxLinesCap = opts.maxLines || 10;
  let maxLines = 1;
  const n = Math.max(values?.length || 0, colWidths.length);
  for (let i = 0; i < n; i++) {
    const wrapped = softWrapExcelText(
      values?.[i],
      colWidths[i] ?? colWidths[0] ?? 8,
      fontSize,
    );
    maxLines = Math.max(maxLines, countExcelExplicitLines(wrapped));
  }
  return lineHeightPt * Math.min(maxLines, maxLinesCap);
}

/**
 * Высота блока «преамбула + таблица + подпись карты» в px @ 96 dpi.
 * @param {string[][]} preambleRows
 * @param {string[]} headers
 * @param {unknown[][]} rows
 */
function estimateRouteSheetTableBlockHeightPx(preambleRows, headers, rows) {
  const colW = ROUTE_SHEET_DELIVERY_EXCEL_COL_WIDTHS;
  const fullWidthChars = colW.reduce((a, b) => a + b, 0);
  let heightPt = 0;
  const preamble = Array.isArray(preambleRows) ? preambleRows : [];
  for (let i = 0; i < preamble.length; i++) {
    heightPt += estimateExcelRowHeightPt(preamble[i], [fullWidthChars], {
      fontSize: i === 0 ? 14 : 12,
      // Кратность 15pt: заголовок МЛ крупнее — 2 шага, водитель — 1.
      lineHeightPt: i === 0 ? ROUTE_SHEET_EXCEL_LINE_HEIGHT_PT * 2 : ROUTE_SHEET_EXCEL_LINE_HEIGHT_PT,
      maxLines: 2,
    });
  }
  const preparedHeaders = prepareDeliveryExcelRow(headers, colW);
  heightPt += estimateExcelRowHeightPt(preparedHeaders, colW, {
    fontSize: ROUTE_SHEET_EXCEL_DATA_FONT_SIZE,
    maxLines: 2,
  });
  for (const r of rows) {
    const prepared = prepareDeliveryExcelRow(r, colW);
    heightPt += estimateExcelRowHeightPt(prepared, colW, {
      fontSize: ROUTE_SHEET_EXCEL_DATA_FONT_SIZE,
      maxLines: 10,
    });
  }
  heightPt += ROUTE_SHEET_EXCEL_LINE_HEIGHT_PT; // «Карта маршрута»
  return Math.round(routeSheetExcelPointsToPx(heightPt));
}

/**
 * Размер области карты на листе: ширина = ширина таблицы, высота = остаток A4.
 * @param {string[][]} preambleRows
 * @param {string[]} headers
 * @param {unknown[][]} rows
 * @returns {{ width: number, height: number, mapRowCount: number }}
 */
function routeSheetMapPrintSizePx(preambleRows, headers, rows) {
  const printable = routeSheetExcelPrintablePx();
  const mapWidth = Math.max(200, routeSheetDeliveryTableWidthPx());
  const usedH = estimateRouteSheetTableBlockHeightPx(preambleRows, headers, rows);
  const mapHeightRaw = Math.max(ROUTE_SHEET_EXCEL_MAP_MIN_HEIGHT_PX, printable.height - usedH);
  const rowHpx = routeSheetExcelPointsToPx(ROUTE_SHEET_EXCEL_MAP_ROW_HEIGHT_PT);
  // floor — не вылезать на 2-ю страницу; максимум строк в остаток A4.
  const mapRowCount = Math.max(1, Math.floor(mapHeightRaw / rowHpx));
  const height = Math.round(mapRowCount * rowHpx);
  return { width: mapWidth, height, mapRowCount };
}

/**
 * object-fit: cover — вписать source в targetW×targetH, пропорции сохранить, лишнее обрезать.
 * Выходной canvas в пикселях слота (для Excel ext) или кратно для качества.
 * @param {HTMLCanvasElement} source
 * @param {number} targetW
 * @param {number} targetH
 * @param {number} [qualityScale] множитель разрешения PNG (2 = чётче на печати)
 */
function cropCanvasCover(source, targetW, targetH, qualityScale = 2) {
  const tw = Math.max(1, Math.round(targetW));
  const th = Math.max(1, Math.round(targetH));
  if (!source?.width || !source?.height) return source;
  const scale = Math.max(tw / source.width, th / source.height);
  const srcW = Math.min(source.width, tw / scale);
  const srcH = Math.min(source.height, th / scale);
  const sx = Math.max(0, (source.width - srcW) / 2);
  const sy = Math.max(0, (source.height - srcH) / 2);
  const q = Math.max(1, Math.min(3, Math.round(qualityScale)));
  const out = document.createElement("canvas");
  out.width = tw * q;
  out.height = th * q;
  const ctx = out.getContext("2d");
  if (!ctx) return source;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, srcW, srcH, 0, 0, out.width, out.height);
  return out;
}

function getExcelJsConstructor() {
  return globalThis.ExcelJS ?? globalThis.exceljs?.default ?? globalThis.exceljs;
}

/**
 * Ждёт завершения загрузки тайлов текущего вида (или таймаут).
 * @param {*} map
 * @param {number} timeoutMs
 */
function waitForVisibleTilesLoaded(map, timeoutMs) {
  return new Promise((resolve) => {
    const done = () => resolve();
    const t = window.setTimeout(done, timeoutMs);
    let tileLayer = null;
    map.eachLayer((ly) => {
      if (ly instanceof globalThis.L.TileLayer) tileLayer = ly;
    });
    if (!tileLayer || !tileLayer.isLoading || !tileLayer.isLoading()) {
      window.clearTimeout(t);
      return done();
    }
    tileLayer.once("load", () => {
      window.clearTimeout(t);
      done();
    });
  });
}

/** Мин. сторона квадратного снимка карты (cover-crop обрежет под слот A4). */
const ROUTE_MAP_EXCEL_CAPTURE_MIN_SIDE_PX = 900;

/**
 * Снимок Leaflet: крупный квадратный кадр с маршрутом, затем cover-crop под слот A4
 * (пропорции сохраняются, лишнее обрезается по краям).
 * @param {{ width: number, height: number }} printSize размер области карты на листе (px @ 96 dpi)
 * @returns {Promise<HTMLCanvasElement | null>}
 */
async function captureRouteDeliveryMapCanvasForExcel(printSize) {
  const L = globalThis.L;
  const html2canvas = globalThis.html2canvas;
  const el = document.getElementById("routeSheetDeliveryMap");
  if (!L || !html2canvas || !el || !routeDeliveryMap) return null;

  const targetW = Math.max(1, Math.round(printSize?.width || 0));
  const targetH = Math.max(1, Math.round(printSize?.height || 0));
  if (!targetW || !targetH) return null;

  routeDeliveryMap.closePopup?.();

  const prev = {
    width: el.style.width,
    height: el.style.height,
    minHeight: el.style.minHeight,
    maxHeight: el.style.maxHeight,
  };

  // Квадрат ≥ слота: после cover-crop заполняет оставшуюся область A4 без растягивания.
  const captureSide = Math.max(ROUTE_MAP_EXCEL_CAPTURE_MIN_SIDE_PX, targetW, targetH);
  el.style.width = `${captureSide}px`;
  el.style.height = `${captureSide}px`;
  el.style.minHeight = `${captureSide}px`;
  el.style.maxHeight = "none";

  routeDeliveryMap.invalidateSize(false);
  await new Promise((r) => {
    routeDeliveryMap.whenReady(r);
  });

  // После смены размера контейнера снова вписать маршрут/маркеры в кадр.
  // L.layerGroup не имеет getBounds — собираем границы по дочерним слоям.
  try {
    let bounds = null;
    const extendWith = (b) => {
      if (!b || typeof b.isValid !== "function" || !b.isValid()) return;
      bounds = bounds ? bounds.extend(b) : L.latLngBounds(b);
    };
    for (const group of [routeDeliveryRouteLayer, routeDeliveryMarkersLayer, routeDeliveryOfficeLayer]) {
      if (!group || typeof group.eachLayer !== "function") continue;
      group.eachLayer((ly) => {
        if (typeof ly.getBounds === "function") {
          extendWith(ly.getBounds());
        } else if (typeof ly.getLatLng === "function") {
          const ll = ly.getLatLng();
          if (ll) extendWith(L.latLngBounds([ll, ll]));
        }
      });
    }
    if (bounds && bounds.isValid()) {
      routeDeliveryMap.fitBounds(bounds, { padding: [36, 36], maxZoom: 15, animate: false });
    }
  } catch {
    /* оставляем текущий вид */
  }

  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await waitForVisibleTilesLoaded(routeDeliveryMap, 3200);
  await sleep(120);

  const dpr = window.devicePixelRatio || 1;
  const h2cScale = Math.min(3, Math.max(2, Math.round(dpr * 1.75)));

  let shot;
  try {
    shot = await html2canvas(el, {
      useCORS: true,
      allowTaint: false,
      backgroundColor: "#ffffff",
      scale: h2cScale,
      logging: false,
      ignoreElements: (node) =>
        node instanceof Element && Boolean(node.closest(".leaflet-control-container")),
    });
  } catch {
    shot = null;
  } finally {
    el.style.width = prev.width;
    el.style.height = prev.height;
    el.style.minHeight = prev.minHeight;
    el.style.maxHeight = prev.maxHeight;
    routeDeliveryMap.invalidateSize(false);
    scheduleInvalidateRouteDeliveryMap();
  }

  if (!shot) return null;
  // Сохранить пропорции: масштаб cover + обрезка под точный слот на листе.
  return cropCanvasCover(shot, targetW, targetH, 2);
}

/**
 * @param {string[]} headers
 * @param {unknown[][]} rows
 * @param {HTMLCanvasElement | null} mapCanvas
 * @param {string[][]} [preambleRows] строки над таблицей (дата МЛ, водитель)
 * @param {{ width: number, height: number, mapRowCount: number } | null} [mapPrintSize]
 */
async function exportRouteSheetDeliveryWorkbookExcelJs(
  headers,
  rows,
  mapCanvas,
  preambleRows = [],
  mapPrintSize = null,
) {
  const ExcelJS = getExcelJsConstructor();
  if (!ExcelJS) throw new Error("ExcelJS missing");

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Доставка", {
    pageSetup: {
      paperSize: 9,
      orientation: "portrait",
      fitToPage: false,
      margins: {
        left: ROUTE_SHEET_EXCEL_PAGE.marginLeftIn,
        right: ROUTE_SHEET_EXCEL_PAGE.marginRightIn,
        top: ROUTE_SHEET_EXCEL_PAGE.marginTopIn,
        bottom: ROUTE_SHEET_EXCEL_PAGE.marginBottomIn,
        header: 0.3,
        footer: 0.3,
      },
    },
  });

  const preamble = Array.isArray(preambleRows) ? preambleRows : [];
  const colW = ROUTE_SHEET_DELIVERY_EXCEL_COL_WIDTHS;
  const fullWidthChars = colW.reduce((a, b) => a + b, 0);

  for (let i = 0; i < preamble.length; i++) {
    const pr = preamble[i];
    const excelRow = worksheet.addRow(pr);
    excelRow.height = estimateExcelRowHeightPt(pr, [fullWidthChars], {
      fontSize: i === 0 ? 14 : 12,
      lineHeightPt: i === 0 ? ROUTE_SHEET_EXCEL_LINE_HEIGHT_PT * 2 : ROUTE_SHEET_EXCEL_LINE_HEIGHT_PT,
      maxLines: 2,
    });
  }
  const headerRowIndex = preamble.length + 1;
  const preparedHeaders = prepareDeliveryExcelRow(headers, colW);
  const headerExcelRow = worksheet.addRow(preparedHeaders);
  headerExcelRow.height = estimateExcelRowHeightPt(preparedHeaders, colW, {
    fontSize: ROUTE_SHEET_EXCEL_DATA_FONT_SIZE,
    maxLines: 2,
  });
  for (const r of rows) {
    const prepared = prepareDeliveryExcelRow(r, colW);
    const excelRow = worksheet.addRow(prepared);
    excelRow.height = estimateExcelRowHeightPt(prepared, colW, {
      fontSize: ROUTE_SHEET_EXCEL_DATA_FONT_SIZE,
      maxLines: 10,
    });
  }

  const numCols = headers.length;
  for (let i = 0; i < preamble.length; i++) {
    const rn = i + 1;
    if (numCols > 1) {
      worksheet.mergeCells(rn, 1, rn, numCols);
    }
    const cell = worksheet.getRow(rn).getCell(1);
    cell.font = { ...cell.font, bold: true, size: i === 0 ? 14 : 12 };
    cell.alignment = { vertical: "middle", wrapText: true };
  }

  const wrapTop = { vertical: "top", wrapText: true };
  const dataFont = { size: ROUTE_SHEET_EXCEL_DATA_FONT_SIZE };
  const headerFont = { size: ROUTE_SHEET_EXCEL_DATA_FONT_SIZE, bold: true };
  const tableRowEnd = headerRowIndex + rows.length;
  for (let rn = headerRowIndex; rn <= tableRowEnd; rn++) {
    const row = worksheet.getRow(rn);
    for (let c = 1; c <= numCols; c++) {
      const cell = row.getCell(c);
      cell.alignment = wrapTop;
      cell.border = ROUTE_SHEET_DELIVERY_EXCEL_BORDER_THIN;
      if (rn === headerRowIndex) {
        cell.font = headerFont;
        cell.fill = ROUTE_SHEET_DELIVERY_EXCEL_HEADER_FILL;
      } else {
        cell.font = dataFont;
      }
    }
  }

  for (let i = 0; i < headers.length; i++) {
    worksheet.getColumn(i + 1).width = colW[i] ?? 8;
  }

  if (mapCanvas) {
    const printSize =
      mapPrintSize || routeSheetMapPrintSizePx(preamble, headers, rows);
    const mapRowCount = Math.max(1, printSize.mapRowCount || 1);

    // PNG уже cover-crop под слот; ext = тот же слот — без растягивания (не twoCell).
    const dataUrl = mapCanvas.toDataURL("image/png");
    const comma = dataUrl.indexOf(",");
    const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    const imageId = workbook.addImage({ base64, extension: "png" });
    const titleRow = worksheet.addRow(["Карта маршрута"]);
    if (titleRow) {
      titleRow.font = { bold: true };
      titleRow.height = ROUTE_SHEET_EXCEL_LINE_HEIGHT_PT;
    }

    const mapTlRow = worksheet.lastRow ? worksheet.lastRow.number : 0;
    for (let i = 0; i < mapRowCount; i++) {
      const spacer = worksheet.addRow([]);
      spacer.height = ROUTE_SHEET_EXCEL_MAP_ROW_HEIGHT_PT;
    }
    worksheet.addImage(imageId, {
      tl: { col: 0, row: mapTlRow },
      ext: { width: printSize.width, height: printSize.height },
      editAs: "oneCell",
    });
  }

  const buf = await workbook.xlsx.writeBuffer();
  downloadXlsxBuffer(buf, `marshrutnyy_list_dostavka_${excelFileNameTimestamp()}.xlsx`);
}

/**
 * @param {string[]} headers
 * @param {unknown[][]} rows
 * @param {string} sheetName
 * @param {string} filePrefix
 * @param {{ deliveryPrintLayout?: boolean, preambleRows?: string[][] }} [opts]
 */
async function exportSheet(headers, rows, sheetName, filePrefix, opts = {}) {
  let XLSX;
  try {
    XLSX = await ensureXlsx();
  } catch (e) {
    console.error(e);
    const msgEl = document.getElementById("routeSheetMessage");
    if (msgEl) msgEl.textContent = "Не удалось загрузить модуль Excel. Обновите страницу.";
    return;
  }
  const preamble = Array.isArray(opts.preambleRows) ? opts.preambleRows : [];
  const aoa = [...preamble, headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const numCols = Math.max(headers.length, ...aoa.map((row) => row.length));
  if (opts.deliveryPrintLayout) {
    applyDeliveryPrintColumnWidthsXlsx(ws, numCols);
  } else {
    applyAutoColumnWidths(ws, aoa);
  }
  if (preamble.length && numCols > 1) {
    if (!ws["!merges"]) ws["!merges"] = [];
    for (let r = 0; r < preamble.length; r++) {
      ws["!merges"].push({ s: { r, c: 0 }, e: { r, c: numCols - 1 } });
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const xlsxName = `${filePrefix}_${excelFileNameTimestamp()}.xlsx`;
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  downloadXlsxBuffer(out, xlsxName);
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

function rowDeliveryMainValues(order, pointNum) {
  const kmEntry = deliveryKmByOrderId.get(order.id);
  const kmCell = formatKmCellDisplay(kmEntry);
  const clientBase = String(order.client ?? "").trim();
  const phoneBase = String(order.phone ?? "").trim();
  // Имя и телефон — отдельные строки: иначе wrapText режет низ и высота строки занижается.
  const clientWithPhone = phoneBase
    ? clientBase
      ? `${clientBase}\n${phoneBase}`
      : phoneBase
    : clientBase;
  const addressBase = String(order.address ?? "").trim();
  let addressWithKm = addressBase;
  if (kmCell && kmCell !== "—") {
    const kmMatch = kmCell.match(/^([0-9]+(?:,[0-9]+)?)(?:\s+\((Юг|Север)\))?$/);
    if (kmMatch) {
      const kmNum = kmMatch[1];
      const hem = kmMatch[2] ? String(kmMatch[2]).toLowerCase() : "";
      const kmText = hem ? `${kmNum} км - ${hem}` : `${kmNum} км`;
      addressWithKm = `${addressBase} (${kmText})`.trim();
    }
  }
  return [
    pointNum,
    routeSheetOrderChipPlain(order) || "",
    normalizeExcelMultilineText(clientWithPhone),
    normalizeExcelMultilineText(addressWithKm),
    normalizeExcelMultilineText(routeSheetDeliveryDescriptionFullPlain(order)),
    boolDaNet(order.installation) === "да"
      ? "-"
      : !isOrderPaid(order) && order.remaining_amount != null && order.remaining_amount !== ""
        ? formatAmount(order.remaining_amount)
        : "-",
    "", // Подпись получателя — пустое поле для подписи на бумаге
  ];
}

/** При уходе с раздела — отменить фоновое геокодирование и очистить маркеры. */
export function bumpRouteDeliveryMapGeneration() {
  routeDeliveryPipelineGeneration += 1;
  routeDeliveryComposeGeneration += 1;
  deliveryKmByOrderId.clear();
  clearRouteDeliveryMarkersAndRoadRoute();
  setRouteDeliveryMapStatus("");
}

export async function exportRouteSheetDeliveryExcel() {
  const { fromKey, toKey, valid } = getRangeFromDom();
  if (!valid || fromKey > toKey) return;
  const base = filterRouteSheetDeliveryOrdersByShipment(
    ordersVisibleOnRouteSheet({ includeShopForUserLite: true }),
    fromKey,
    toKey,
    DELIVERY_SHIP,
  );
  const manual = manualDeliveryOrdersInRange(fromKey, toKey);
  const list = base.concat(manual);
  const numberedEntries = ordersDeliveryListForExcelExport(list);
  const msgEl = document.getElementById("routeSheetMessage");
  const exportBtn = document.getElementById("routeSheetExportDeliveryBtn");

  if (!numberedEntries.length) {
    if (msgEl) {
      msgEl.textContent =
        "Нет строк для выгрузки: составьте маршрут или укажите номера точек у заказов доставки.";
    }
    return;
  }

  // В Excel: только строки с номерами точек, по возрастанию номера; первая колонка — эти номера.
  const rows = numberedEntries.map(({ order, pointNum }) =>
    rowDeliveryMainValues(order, pointNum),
  );
  const preambleRows = buildRouteSheetDeliveryExcelPreamble();

  if (exportBtn) exportBtn.disabled = true;
  if (msgEl) msgEl.textContent = "Готовим Excel с картой…";

  try {
    await Promise.all([ensureExcelJs(), ensureHtml2Canvas(), ensureLeaflet()]);
  } catch (e) {
    console.warn("Модули Excel/карты:", e);
  }

  const ExcelJS = getExcelJsConstructor();
  const html2canvas = globalThis.html2canvas;
  if (!ExcelJS || !html2canvas) {
    await exportSheet(HEADERS_DELIVERY, rows, "Доставка", "marshrutnyy_list_dostavka", {
      deliveryPrintLayout: true,
      preambleRows,
    });
    if (msgEl) {
      msgEl.textContent =
        "Карта в файл не добавлена: не загрузились модули Excel/снимок экрана. Обновите страницу.";
    }
    if (exportBtn) exportBtn.disabled = false;
    return;
  }

  try {
    ensureRouteDeliveryMap();
    const mapPrintSize = routeSheetMapPrintSizePx(preambleRows, HEADERS_DELIVERY, rows);
    const mapCanvas = await captureRouteDeliveryMapCanvasForExcel(mapPrintSize);
    await exportRouteSheetDeliveryWorkbookExcelJs(
      HEADERS_DELIVERY,
      rows,
      mapCanvas,
      preambleRows,
      mapPrintSize,
    );
    if (msgEl) {
      if (!mapCanvas) {
        msgEl.textContent =
          "Таблица сохранена; снимок карты не получился (часто помогает обновить страницу после изменений на карте).";
      } else if (!routeDeliveryComposedRouteActive) {
        msgEl.textContent =
          "Файл сохранён. Маршрут на карте не был составлен — в файле текущий вид карты (без линии маршрута).";
      } else {
        msgEl.textContent = "";
      }
    }
  } catch (e) {
    console.error(e);
    await exportSheet(HEADERS_DELIVERY, rows, "Доставка", "marshrutnyy_list_dostavka", {
      deliveryPrintLayout: true,
      preambleRows,
    });
    if (msgEl) {
      msgEl.textContent =
        "Не удалось встроить карту; выгружена только таблица. Обновите страницу или нажмите «Составить маршрут» и повторите.";
    }
  } finally {
    if (exportBtn) exportBtn.disabled = false;
  }
}

export async function exportRouteSheetPickupExcel() {
  const { fromKey, toKey, valid } = getRangeFromDom();
  if (!valid || fromKey > toKey) return;
  const list = filterMainOrdersByShipment(
    ordersVisibleOnRouteSheet({ includeShopForUserLite: true }),
    fromKey,
    toKey,
    DELIVERY_PICKUP,
  );
  const rows = list.map(rowMainValues);
  await exportSheet(HEADERS_MAIN, rows, "Самовывоз", "marshrutnyy_list_samovyvoz");
}

function clearRouteSheetAddressGeoPopoverFields() {
  const inp = document.getElementById("routeSheetAddressGeoInput");
  if (inp) inp.value = "";
  const err = document.getElementById("routeSheetAddressGeoError");
  if (err) {
    err.hidden = true;
    err.textContent = "";
  }
}

function closeRouteSheetAddressGeoPopover() {
  const pop = document.getElementById("routeSheetAddressGeoPopover");
  if (pop) pop.hidden = true;
  clearRouteSheetAddressGeoPopoverFields();
  routeSheetAddressGeoPopoverState.orderId = null;
  routeSheetAddressGeoPopoverState.manualOrderId = null;
  routeSheetAddressGeoPopoverState.saveAllowed = false;
  routeSheetAddressGeoPopoverState.previousCoordinates = "";
  routeSheetAddressGeoPopoverState.address = "";
}

function positionRouteSheetAddressGeoPopover(anchorEl) {
  const pop = document.getElementById("routeSheetAddressGeoPopover");
  if (!pop || !anchorEl) return;
  const tr = anchorEl.closest("tr");
  const rect = (tr || anchorEl).getBoundingClientRect();
  pop.hidden = false;
  const margin = 8;
  const w = pop.getBoundingClientRect().width || 320;
  let left = rect.left;
  left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));
  pop.style.left = `${Math.round(left)}px`;
  let top = rect.bottom + 6;
  const h = pop.getBoundingClientRect().height;
  if (top + h + margin > window.innerHeight) {
    top = Math.max(margin, rect.top - h - 6);
  }
  pop.style.top = `${Math.round(top)}px`;
}

function openRouteSheetAddressGeoPopover(anchorEl) {
  const orderIdRaw = anchorEl.getAttribute("data-order-id") || "";
  if (!orderIdRaw) return;

  let order =
    routeSheetManualDeliveryOrders.find((o) => String(o.id) === orderIdRaw) || null;
  if (!order) {
    const n = Number(orderIdRaw);
    if (Number.isFinite(n)) {
      order = (state.allOrders || []).find((o) => Number(o.id) === n) || null;
    }
  }
  if (!order) return;

  clearRouteSheetAddressGeoPopoverFields();
  if (order.route_sheet_manual === true) {
    routeSheetAddressGeoPopoverState.orderId = null;
    routeSheetAddressGeoPopoverState.manualOrderId = String(order.id);
    routeSheetAddressGeoPopoverState.saveAllowed = true;
  } else {
    routeSheetAddressGeoPopoverState.orderId = Number(order.id);
    routeSheetAddressGeoPopoverState.manualOrderId = null;
    routeSheetAddressGeoPopoverState.saveAllowed = Boolean(order) && canMutateOrders();
  }
  routeSheetAddressGeoPopoverState.previousCoordinates =
    order?.coordinates != null && String(order.coordinates).trim() !== "" ? String(order.coordinates).trim() : "";
  routeSheetAddressGeoPopoverState.address = String(order.address ?? "").trim();

  const inp = document.getElementById("routeSheetAddressGeoInput");
  if (inp) inp.value = routeSheetAddressGeoPopoverState.previousCoordinates;

  positionRouteSheetAddressGeoPopover(anchorEl);
  routeSheetAddressGeoIgnoreScrollUntil = Date.now() + 800;
  if (inp) {
    try {
      inp.focus({ preventScroll: true });
    } catch {
      inp.focus();
    }
  }
}

function routeSheetAddressGeoOutsideClick(e) {
  const pop = document.getElementById("routeSheetAddressGeoPopover");
  if (!pop || pop.hidden) return;
  if (pop.contains(e.target)) return;
  if (e.target.closest?.("#routeSheetTableDelivery td.route-sheet-col-km[data-order-id]")) return;
  closeRouteSheetAddressGeoPopover();
}

function routeSheetAddressGeoKeydown(e) {
  if (e.key !== "Escape") return;
  const pop = document.getElementById("routeSheetAddressGeoPopover");
  if (!pop || pop.hidden) return;
  closeRouteSheetAddressGeoPopover();
}

function routeSheetAddressGeoScrollClose() {
  const pop = document.getElementById("routeSheetAddressGeoPopover");
  if (!pop || pop.hidden) return;
  if (Date.now() < routeSheetAddressGeoIgnoreScrollUntil) return;
  closeRouteSheetAddressGeoPopover();
}

function initRouteSheetAddressGeoPopover() {
  const section = document.getElementById("section-route-sheet");
  if (!section || section.dataset.routeSheetAddressGeoBound) return;
  section.dataset.routeSheetAddressGeoBound = "1";

  section.addEventListener("click", (e) => {
    const kmTd = e.target.closest("#routeSheetTableDelivery td.route-sheet-col-km[data-order-id]");
    if (!kmTd || !section.contains(kmTd)) return;
    e.preventDefault();
    e.stopPropagation();
    openRouteSheetAddressGeoPopover(kmTd);
  });

  const saveBtn = document.getElementById("routeSheetAddressGeoSaveBtn");
  const cancelBtn = document.getElementById("routeSheetAddressGeoCancelBtn");
  if (cancelBtn && !cancelBtn.dataset.routeSheetAddressGeoBound) {
    cancelBtn.dataset.routeSheetAddressGeoBound = "1";
    cancelBtn.addEventListener("click", () => {
      closeRouteSheetAddressGeoPopover();
    });
  }

  if (saveBtn && !saveBtn.dataset.routeSheetAddressGeoBound) {
    saveBtn.dataset.routeSheetAddressGeoBound = "1";
    saveBtn.addEventListener("click", async () => {
      const errEl = document.getElementById("routeSheetAddressGeoError");
      const inp = document.getElementById("routeSheetAddressGeoInput");
      if (errEl) {
        errEl.hidden = true;
        errEl.textContent = "";
      }

      if (!routeSheetAddressGeoPopoverState.saveAllowed) {
        if (errEl) {
          errEl.textContent = "Нет прав на сохранение координат для этого заказа.";
          errEl.hidden = false;
        }
        return;
      }

      const raw = (inp?.value ?? "").trim();
      let payload = /** @type {{ coordinates: string | null }} */ ({ coordinates: null });

      if (raw === "") {
        payload = { coordinates: null };
      } else {
        const parsed = parseLatLonCommaInput(raw);
        if (!parsed) {
          if (errEl) {
            errEl.textContent =
              "Укажите координаты в формате «широта, долгота», например 48.753016, 44.495766, или очистите поле.";
            errEl.hidden = false;
          }
          return;
        }
        payload = { coordinates: formatCoordinatesForStorage(parsed) };
      }

      const persistGeoForAddress = async (coordStr) => {
        const parsedGeo = parseLatLonCommaInput(coordStr);
        const addr = routeSheetAddressGeoPopoverState.address;
        if (!parsedGeo || !addr) return true;
        if (!routeSheetGeoDbKeyFromDisplayAddress(addr)) return true;
        return persistCoordinatesAttachedToAddress(addr, parsedGeo.lat, parsedGeo.lon, null);
      };

      const manualId = routeSheetAddressGeoPopoverState.manualOrderId;
      if (manualId) {
        const mo = routeSheetManualDeliveryOrders.find((o) => String(o.id) === manualId);
        if (!mo) return;
        saveBtn.disabled = true;
        try {
          mo.coordinates = payload.coordinates != null ? payload.coordinates : "";
          persistRouteSheetManualToSession();
          const geoOk = await persistGeoForAddress(mo.coordinates);
          closeRouteSheetAddressGeoPopover();
          setMessage(
            geoOk ? "Координаты точки обновлены" : "Координаты точки обновлены, справочник адресов обновить не удалось",
            geoOk ? "#2e7d32" : "#c62828",
          );
          loadRouteSheet();
        } finally {
          saveBtn.disabled = false;
        }
        return;
      }

      const oid = routeSheetAddressGeoPopoverState.orderId;
      if (!Number.isFinite(oid)) return;

      saveBtn.disabled = true;
      try {
        const { error } = await supabaseClient.from("orders").update(payload).eq("id", oid);
        if (error) {
          console.error("route-sheet coordinates update:", error);
          setMessage(`Не удалось сохранить координаты: ${error.message || ""}`.trim(), "#d32f2f");
          return;
        }
        if (state.currentUser?.email) {
          const prev = routeSheetAddressGeoPopoverState.previousCoordinates || "—";
          const next = payload.coordinates ?? "—";
          const { error: histError } = await supabaseClient.from("order_history").insert([
            {
              order_id: oid,
              user_email: state.currentUser.email,
              comment: `Координаты: ${prev} → ${next}`,
            },
          ]);
          if (histError) console.warn("order_history:", histError.message);
        }
        const geoOk = await persistGeoForAddress(payload.coordinates);
        closeRouteSheetAddressGeoPopover();
        setMessage(
          geoOk ? "Координаты сохранены" : "Координаты заказа сохранены, справочник адресов обновить не удалось",
          geoOk ? "#2e7d32" : "#c62828",
        );
        await loadOrders();
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  if (!document.documentElement.dataset.routeSheetAddressGeoDocBound) {
    document.documentElement.dataset.routeSheetAddressGeoDocBound = "1";
    document.addEventListener("click", routeSheetAddressGeoOutsideClick);
    document.addEventListener("keydown", routeSheetAddressGeoKeydown);
    window.addEventListener("scroll", routeSheetAddressGeoScrollClose, true);
  }
}

function clearRouteSheetAddPointFormError() {
  const err = document.getElementById("routeSheetAddPointError");
  if (err) {
    err.hidden = true;
    err.textContent = "";
  }
}

function setRouteSheetAddPointFormError(text) {
  const err = document.getElementById("routeSheetAddPointError");
  if (err) {
    err.textContent = text;
    err.hidden = false;
  }
}

function setRouteSheetAddPointDialogMode(isEdit) {
  const title = document.getElementById("routeSheetAddPointDialogTitle");
  const confirmBtn = document.getElementById("routeSheetAddPointConfirmBtn");
  if (title) title.textContent = isEdit ? "Редактировать точку доставки" : "Добавить точку доставки";
  if (confirmBtn) confirmBtn.textContent = isEdit ? "Сохранить изменения" : "Добавить точку";
}

function resetRouteSheetAddPointFormDefaults() {
  const fromEl = document.getElementById("routeSheetDateFrom");
  const dateEl = document.getElementById("routeSheetAddPointDate");
  if (dateEl) dateEl.value = (fromEl?.value || "").trim() || getTomorrowIsoDate();

  const ids = [
    "routeSheetAddPointClient",
    "routeSheetAddPointAddress",
    "routeSheetAddPointCoordinates",
    "routeSheetAddPointDescription",
    "routeSheetAddPointRemainder",
    "routeSheetAddPointAreaM2",
    "routeSheetAddPointConstruction",
    "routeSheetAddPointPhone",
  ];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.value = "";
  }
  const inst = document.getElementById("routeSheetAddPointInstallation");
  const rev = document.getElementById("routeSheetAddPointReveals");
  if (inst) inst.checked = false;
  if (rev) rev.checked = false;
  clearRouteSheetAddPointFormError();
}

function fillRouteSheetAddPointFormFromOrder(order) {
  const dateEl = document.getElementById("routeSheetAddPointDate");
  const clientEl = document.getElementById("routeSheetAddPointClient");
  const addrEl = document.getElementById("routeSheetAddPointAddress");
  const coordEl = document.getElementById("routeSheetAddPointCoordinates");
  const descEl = document.getElementById("routeSheetAddPointDescription");
  const remEl = document.getElementById("routeSheetAddPointRemainder");
  const areaEl = document.getElementById("routeSheetAddPointAreaM2");
  const consEl = document.getElementById("routeSheetAddPointConstruction");
  const instEl = document.getElementById("routeSheetAddPointInstallation");
  const revEl = document.getElementById("routeSheetAddPointReveals");
  const phoneEl = document.getElementById("routeSheetAddPointPhone");

  if (dateEl) dateEl.value = String(order.delivery_date ?? "").trim();
  if (clientEl) clientEl.value = String(order.client ?? "");
  if (addrEl) addrEl.value = String(order.address ?? "");
  if (coordEl) coordEl.value = String(order.coordinates ?? "");
  if (descEl) descEl.value = String(order.description ?? "");
  if (remEl) {
    remEl.value =
      order.remaining_amount != null && order.remaining_amount !== ""
        ? formatAmount(order.remaining_amount)
        : "";
  }
  if (areaEl) areaEl.value = String(order.area_m2 ?? "");
  if (consEl) consEl.value = String(order.construction_count ?? "");
  if (instEl) instEl.checked = Boolean(order.installation);
  if (revEl) revEl.checked = Boolean(order.reveals);
  if (phoneEl) phoneEl.value = String(order.phone ?? "");
  clearRouteSheetAddPointFormError();
}

function focusRouteSheetAddPointDate() {
  const first = document.getElementById("routeSheetAddPointDate");
  if (!first) return;
  try {
    first.focus({ preventScroll: true });
  } catch {
    first.focus();
  }
}

function openRouteSheetAddPointDialog() {
  const dlg = document.getElementById("routeSheetAddPointDialog");
  if (!dlg || typeof dlg.showModal !== "function") return;
  routeSheetAddPointEditingId = null;
  setRouteSheetAddPointDialogMode(false);
  resetRouteSheetAddPointFormDefaults();
  dlg.showModal();
  focusRouteSheetAddPointDate();
}

function openRouteSheetEditPointDialog(manualId) {
  const dlg = document.getElementById("routeSheetAddPointDialog");
  if (!dlg || typeof dlg.showModal !== "function") return;
  const idStr = String(manualId ?? "").trim();
  const order = routeSheetManualDeliveryOrders.find((o) => String(o.id) === idStr);
  if (!order) return;
  routeSheetAddPointEditingId = idStr;
  setRouteSheetAddPointDialogMode(true);
  fillRouteSheetAddPointFormFromOrder(order);
  dlg.showModal();
  focusRouteSheetAddPointDate();
}

function closeRouteSheetAddPointDialog() {
  const dlg = document.getElementById("routeSheetAddPointDialog");
  if (dlg && typeof dlg.close === "function") dlg.close();
  routeSheetAddPointEditingId = null;
  setRouteSheetAddPointDialogMode(false);
  clearRouteSheetAddPointFormError();
}

function clearRouteSheetPointByNoError() {
  const err = document.getElementById("routeSheetPointByNoError");
  if (err) {
    err.hidden = true;
    err.textContent = "";
  }
}

function setRouteSheetPointByNoError(text) {
  const err = document.getElementById("routeSheetPointByNoError");
  if (err) {
    err.textContent = text;
    err.hidden = false;
  }
}

function resetRouteSheetPointByNoForm() {
  const inp = document.getElementById("routeSheetPointByNoInput");
  if (inp) inp.value = "";
  clearRouteSheetPointByNoError();
}

function openRouteSheetPointByNoDialog() {
  const dlg = document.getElementById("routeSheetPointByNoDialog");
  if (!dlg || typeof dlg.showModal !== "function") return;
  resetRouteSheetPointByNoForm();
  dlg.showModal();
  const inp = document.getElementById("routeSheetPointByNoInput");
  if (inp) {
    try {
      inp.focus({ preventScroll: true });
    } catch {
      inp.focus();
    }
  }
}

function closeRouteSheetPointByNoDialog() {
  const dlg = document.getElementById("routeSheetPointByNoDialog");
  if (dlg && typeof dlg.close === "function") dlg.close();
  clearRouteSheetPointByNoError();
}

async function confirmRouteSheetPointByNo() {
  clearRouteSheetPointByNoError();

  const inp = document.getElementById("routeSheetPointByNoInput");
  const raw = (inp?.value ?? "").trim();

  if (!raw) {
    setRouteSheetPointByNoError("Укажите номер заказа.");
    return;
  }

  const digitsOnly = /^\d+$/.test(raw);
  const order = findOrderByRouteSheetNumberInput(raw);
  if (!order) {
    setRouteSheetPointByNoError(
      digitsOnly
        ? "Заказ с таким номером не найден."
        : "Заказ не найден. Введите полный номер (как в списке заказов) или только цифры id.",
    );
    return;
  }

  if (!canMutateOrders()) {
    setMessage("Недостаточно прав для изменения заказа.", "#d32f2f");
    return;
  }

  const defaultDeliveryDate = getRouteSheetActiveDeliveryDate();
  const confirmBtn = document.getElementById("routeSheetPointByNoConfirmBtn");
  if (confirmBtn) confirmBtn.disabled = true;
  try {
    // Таблица «Доставка» фильтрует по delivery === «Доставка» и дате — без отправки заказ
    // не появляется в списке (даже если дата уже проставлена).
    const { error } = await supabaseClient
      .from("orders")
      .update({ delivery_date: defaultDeliveryDate, delivery: DELIVERY_SHIP })
      .eq("id", order.id);
    if (error) {
      console.error("route-sheet point by no:", error);
      setRouteSheetPointByNoError(error.message || "Не удалось сохранить заказ.");
      return;
    }
    if (state.currentUser?.email) {
      const { error: histError } = await supabaseClient.from("order_history").insert([
        {
          order_id: order.id,
          user_email: state.currentUser.email,
          comment: `Маршрутный лист: отправка → ${DELIVERY_SHIP}, дата доставки → ${defaultDeliveryDate}`,
        },
      ]);
      if (histError) console.warn("order_history:", histError.message);
    }
    closeRouteSheetPointByNoDialog();
    setMessage(
      `Добавлен в доставку: ${formatOrderIdTypeChip(order.id, order.order_type)}`,
      "#2e7d32",
    );
    await loadOrders();
    loadRouteSheet();
  } finally {
    if (confirmBtn) confirmBtn.disabled = false;
  }
}

function initRouteSheetPointByNoDialog() {
  const dlg = document.getElementById("routeSheetPointByNoDialog");
  const openBtn = document.getElementById("routeSheetPointByNoOpenBtn");
  const closeBtn = document.getElementById("routeSheetPointByNoCloseBtn");
  const cancelBtn = document.getElementById("routeSheetPointByNoCancelBtn");
  const confirmBtn = document.getElementById("routeSheetPointByNoConfirmBtn");

  if (!dlg || !openBtn || dlg.dataset.routeSheetPointByNoBound) return;
  dlg.dataset.routeSheetPointByNoBound = "1";

  openBtn.addEventListener("click", () => openRouteSheetPointByNoDialog());
  if (closeBtn) closeBtn.addEventListener("click", () => closeRouteSheetPointByNoDialog());
  if (cancelBtn) cancelBtn.addEventListener("click", () => closeRouteSheetPointByNoDialog());
  if (confirmBtn) confirmBtn.addEventListener("click", () => void confirmRouteSheetPointByNo());
  dlg.addEventListener("close", () => clearRouteSheetPointByNoError());

  const inp = document.getElementById("routeSheetPointByNoInput");
  if (inp) {
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void confirmRouteSheetPointByNo();
      }
    });
  }
}

async function confirmRouteSheetAddPoint() {
  clearRouteSheetAddPointFormError();

  const dateEl = document.getElementById("routeSheetAddPointDate");
  const clientEl = document.getElementById("routeSheetAddPointClient");
  const addrEl = document.getElementById("routeSheetAddPointAddress");
  const coordEl = document.getElementById("routeSheetAddPointCoordinates");
  const descEl = document.getElementById("routeSheetAddPointDescription");
  const remEl = document.getElementById("routeSheetAddPointRemainder");
  const areaEl = document.getElementById("routeSheetAddPointAreaM2");
  const consEl = document.getElementById("routeSheetAddPointConstruction");
  const instEl = document.getElementById("routeSheetAddPointInstallation");
  const revEl = document.getElementById("routeSheetAddPointReveals");
  const phoneEl = document.getElementById("routeSheetAddPointPhone");

  const editingId = routeSheetAddPointEditingId ? String(routeSheetAddPointEditingId) : "";
  const existing =
    editingId !== ""
      ? routeSheetManualDeliveryOrders.find((o) => String(o.id) === editingId)
      : null;
  if (editingId && !existing) {
    setRouteSheetAddPointFormError("Точка не найдена. Закройте окно и попробуйте снова.");
    return;
  }

  const deliveryDate = (dateEl?.value ?? "").trim();
  const address = (addrEl?.value ?? "").trim();
  const coordsRaw = (coordEl?.value ?? "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) {
    setRouteSheetAddPointFormError("Укажите дату доставки.");
    return;
  }
  if (!address && !coordsRaw) {
    setRouteSheetAddPointFormError("Укажите адрес или координаты.");
    return;
  }
  let coordinates = "";
  if (coordsRaw) {
    const parsed = parseLatLonCommaInput(coordsRaw);
    if (!parsed) {
      setRouteSheetAddPointFormError(
        "Координаты: формат «широта, долгота», например 48.753016, 44.495766, либо оставьте поле пустым.",
      );
      return;
    }
    coordinates = formatCoordinatesForStorage(parsed);
  }

  const remRaw = (remEl?.value ?? "").trim();
  let remaining_amount = null;
  if (remRaw !== "") {
    const pr = tryParseRublesInteger(remRaw, { allowSign: false });
    if (!pr.ok || pr.invalidFormat) {
      setRouteSheetAddPointFormError("Остаток: укажите целое число рублей или оставьте поле пустым.");
      return;
    }
    remaining_amount = pr.value != null ? String(pr.value) : null;
  }

  const fields = {
    delivery_date: deliveryDate,
    client: (clientEl?.value ?? "").trim(),
    address,
    coordinates,
    description: (descEl?.value ?? "").trim(),
    remaining_amount,
    area_m2: (areaEl?.value ?? "").trim(),
    construction_count: (consEl?.value ?? "").trim(),
    installation: Boolean(instEl?.checked),
    reveals: Boolean(revEl?.checked),
    phone: (phoneEl?.value ?? "").trim(),
  };

  if (existing) {
    Object.assign(existing, fields);
  } else {
    routeSheetManualDeliveryOrders.push({
      route_sheet_manual: true,
      id: newRouteSheetManualPointId(),
      route_sheet_display_no: nextRouteSheetManualDisplayNo(),
      order_type: "",
      delivery: DELIVERY_SHIP,
      remaining_to: "",
      mosquito_nets: "",
      ...fields,
    });
  }

  persistRouteSheetManualToSession();
  if (coordinates && address) {
    const parsedGeo = parseLatLonCommaInput(coordinates);
    if (parsedGeo) {
      await persistCoordinatesAttachedToAddress(address, parsedGeo.lat, parsedGeo.lon, null);
    }
  }
  closeRouteSheetAddPointDialog();
  loadRouteSheet();
}

function initRouteSheetAddPointDialog() {
  const dlg = document.getElementById("routeSheetAddPointDialog");
  const openBtn = document.getElementById("routeSheetAddPointOpenBtn");
  const closeBtn = document.getElementById("routeSheetAddPointCloseBtn");
  const cancelBtn = document.getElementById("routeSheetAddPointCancelBtn");
  const confirmBtn = document.getElementById("routeSheetAddPointConfirmBtn");

  if (!dlg || !openBtn || dlg.dataset.routeSheetAddPointBound) return;
  dlg.dataset.routeSheetAddPointBound = "1";

  openBtn.addEventListener("click", () => openRouteSheetAddPointDialog());
  if (closeBtn) closeBtn.addEventListener("click", () => closeRouteSheetAddPointDialog());
  if (cancelBtn) cancelBtn.addEventListener("click", () => closeRouteSheetAddPointDialog());
  if (confirmBtn) confirmBtn.addEventListener("click", () => void confirmRouteSheetAddPoint());
  dlg.addEventListener("close", () => {
    routeSheetAddPointEditingId = null;
    setRouteSheetAddPointDialogMode(false);
    clearRouteSheetAddPointFormError();
  });
}

export function initRouteSheetSection() {
  loadRouteSheetManualFromSession();
  initRouteSheetPointByNoDialog();
  initRouteSheetAddPointDialog();

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

  const mlDateEl = document.getElementById("routeSheetMlDate");
  if (mlDateEl && !mlDateEl.dataset.routeSheetBound) {
    mlDateEl.dataset.routeSheetBound = "1";
    if (!mlDateEl.value) mlDateEl.value = getTomorrowIsoDate();
  }

  const driverEl = document.getElementById("routeSheetDriver");
  if (driverEl && !driverEl.dataset.routeSheetBound) {
    driverEl.dataset.routeSheetBound = "1";
    if (!driverEl.value) driverEl.value = String(state.driverName ?? "").trim();
    const markEdited = () => {
      const current = String(driverEl.value ?? "").trim().replace(/\s+/g, " ");
      const saved = String(state.driverName ?? "").trim().replace(/\s+/g, " ");
      driverEl.dataset.userEdited = current !== saved ? "1" : "";
    };
    driverEl.addEventListener("input", markEdited);
    driverEl.addEventListener("change", markEdited);
  }

  const routeSheetSection = document.getElementById("section-route-sheet");
  if (routeSheetSection && !routeSheetSection.dataset.routeSheetOrderIdMenuBound) {
    routeSheetSection.dataset.routeSheetOrderIdMenuBound = "1";
    routeSheetSection.addEventListener("click", (e) => {
      const editBtn = e.target.closest(".route-sheet-manual-edit-btn");
      if (editBtn && routeSheetSection.contains(editBtn)) {
        e.preventDefault();
        e.stopPropagation();
        const id = editBtn.getAttribute("data-manual-id");
        if (id) {
          closeRouteSheetAddressGeoPopover();
          openRouteSheetEditPointDialog(id);
        }
        return;
      }
      const delBtn = e.target.closest(".route-sheet-manual-delete-btn");
      if (delBtn && routeSheetSection.contains(delBtn)) {
        e.preventDefault();
        e.stopPropagation();
        const id = delBtn.getAttribute("data-manual-id");
        if (id && deleteRouteSheetManualPointById(id)) {
          closeRouteSheetAddressGeoPopover();
          loadRouteSheet();
        }
        return;
      }
      const idTd = e.target.closest("td.td-order-id");
      if (!idTd || !routeSheetSection.contains(idTd)) return;
      if (idTd.classList.contains("td-order-id--route-sheet-manual")) return;
      const raw = idTd.getAttribute("data-order-id") || "";
      const idNum = Number(raw);
      const order =
        Number.isFinite(idNum)
          ? (state.allOrders || []).find((o) => Number(o.id) === idNum) || null
          : null;
      if (order && isOrderHiddenForCurrentRole(order)) return;
      e.stopPropagation();
      e.preventDefault();
      openOrderIdActionsMenu(idTd);
    });
  }

  if (routeSheetSection && !routeSheetSection.dataset.routeSheetPointNumBound) {
    routeSheetSection.dataset.routeSheetPointNumBound = "1";
    routeSheetSection.addEventListener("focusin", (e) => {
      const input = e.target;
      if (!(input instanceof HTMLInputElement)) return;
      if (!input.classList.contains("route-sheet-route-point-num")) return;
      if (!routeSheetSection.contains(input)) return;
      // На телефоне позиция курсора от тапа часто приходит после focus — ставим в конец с задержкой.
      placeRoutePointNumCaretAtEnd(input);
      requestAnimationFrame(() => placeRoutePointNumCaretAtEnd(input));
      setTimeout(() => placeRoutePointNumCaretAtEnd(input), 0);
      setTimeout(() => placeRoutePointNumCaretAtEnd(input), 50);
    });
    routeSheetSection.addEventListener("mouseup", (e) => {
      const input = e.target;
      if (!(input instanceof HTMLInputElement)) return;
      if (!input.classList.contains("route-sheet-route-point-num")) return;
      if (!routeSheetSection.contains(input)) return;
      placeRoutePointNumCaretAtEnd(input);
    });
    routeSheetSection.addEventListener("touchend", (e) => {
      const input = e.target;
      if (!(input instanceof HTMLInputElement)) return;
      if (!input.classList.contains("route-sheet-route-point-num")) return;
      if (!routeSheetSection.contains(input)) return;
      setTimeout(() => placeRoutePointNumCaretAtEnd(input), 0);
    });
    routeSheetSection.addEventListener("input", (e) => {
      const input = e.target;
      if (!(input instanceof HTMLInputElement)) return;
      if (!input.classList.contains("route-sheet-route-point-num")) return;
      if (!routeSheetSection.contains(input)) return;
      // Только цифры; пустое поле в чекбокс не превращаем, пока фокус в поле.
      const digitsOnly = String(input.value ?? "").replace(/\D+/g, "");
      if (digitsOnly !== input.value) input.value = digitsOnly;
    });
    routeSheetSection.addEventListener("blur", (e) => {
      const input = e.target;
      if (!(input instanceof HTMLInputElement)) return;
      if (!input.classList.contains("route-sheet-route-point-num")) return;
      if (!routeSheetSection.contains(input)) return;
      maybeConvertClearedRoutePointNumToCheckbox(input);
    }, true);
  }

  const deliveryBtn = document.getElementById("routeSheetExportDeliveryBtn");
  const pickupBtn = document.getElementById("routeSheetExportPickupBtn");
  if (deliveryBtn && !deliveryBtn.dataset.routeSheetBound) {
    deliveryBtn.dataset.routeSheetBound = "1";
    deliveryBtn.addEventListener("click", () => void exportRouteSheetDeliveryExcel());
  }
  if (pickupBtn && !pickupBtn.dataset.routeSheetBound) {
    pickupBtn.dataset.routeSheetBound = "1";
    pickupBtn.addEventListener("click", () => void exportRouteSheetPickupExcel());
  }

  const composeRouteBtn = document.getElementById("routeSheetComposeRouteBtn");
  if (composeRouteBtn && !composeRouteBtn.dataset.routeSheetBound) {
    composeRouteBtn.dataset.routeSheetBound = "1";
    composeRouteBtn.addEventListener("click", () => void composeDeliveryRoute());
  }

  initRouteSheetAddressGeoPopover();
  loadRouteSheet();
}
