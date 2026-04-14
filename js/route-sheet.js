import { state } from "./state.js";
import { isOrderEditLockedForUserLite, isOrderHiddenFromUserLite, isUserLite, canMutateOrders } from "./roles.js";
import { formatOrderIdTypeChip, formatDateShortRU, formatAmount } from "./format.js";
import { isOrderPaid, loadOrders } from "./orders.js";
import { closeOrderIdActionsMenu, openOrderIdActionsMenu } from "./ui.js";
import { setMessage } from "./dom.js";
import { supabaseClient } from "./config.js";

const MAIN_ORDER_TYPES = new Set(["Окна", "Подоконники", "Аллюминий", "Сетки/мелочь"]);
const SHOP_TYPE = "Магазин";
const DELIVERY_SHIP = "Доставка";
const DELIVERY_PICKUP = "Самовывоз";

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
  "Номер",
  "Дата",
  "Клиент",
  "Адрес",
  "км",
  "Описание",
  "Остаток",
  "Моск.",
  "Конст.",
  "Монтаж",
  "Откосы",
  "Телефон",
];

const HEADERS_SHOP = ["Номер", "Клиент", "Адрес", "Описание", "Телефон"];

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

/** Участок без проезда: маршрут не должен заходить в радиус (м) от точки — берём альтернативу OSRM или наименее «близкий» вариант. */
const OSRM_DETOUR_BLOCK_LAT = 48.689037;
const OSRM_DETOUR_BLOCK_LON = 44.434921;
const OSRM_DETOUR_BLOCK_RADIUS_M = 30;

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

/** Иконка «дом» у адреса в таблице «Доставка». */
const ROUTE_SHEET_HOUSE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;

/** Состояние попапа координат у строки доставки. */
const routeSheetAddressGeoPopoverState = {
  orderId: null,
  saveAllowed: false,
  previousCoordinates: "",
};

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

function deliveryAddressCellHtml(order, opts = {}) {
  const { withDeliveryFullTextAttr = false } = opts;
  const addr = order.address ?? "";
  const textCls = withDeliveryFullTextAttr
    ? "route-sheet-address-text route-sheet-delivery-clamp-inner"
    : "route-sheet-address-text";
  const dataAttr = withDeliveryFullTextAttr ? ` data-fulltext="${escapeAttr(String(addr))}"` : "";
  const saved = orderHasSavedCoordinates(order);
  const houseCls = saved ? "route-sheet-address-geo-open route-sheet-address-geo-open--saved" : "route-sheet-address-geo-open";
  return `<td class="route-sheet-col-address"><span class="route-sheet-address-line"><span class="${textCls}"${dataAttr}>${escapeHtml(addr)}</span><button type="button" class="${houseCls}" aria-label="Координаты на карте" data-order-id="${order.id ?? ""}">${ROUTE_SHEET_HOUSE_SVG}</button></span></td>`;
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

/** Хвост в скобках для колонки «Описание» в таблице «Доставка» (как в форме заказа: м², Моск., Конст., монтаж, откосы). */
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
  if (m2) parts.push(`м2 - ${m2}`);
  if (mosk) parts.push(`Моск.- ${mosk}`);
  if (konst) parts.push(`Конст.- ${konst}`);
  if (mont === "да") parts.push(`Монтаж- ${mont}`);
  if (otk === "да") parts.push(`Откосы- ${otk}`);
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

function filterShopOrders(orders, fromKey, toKey) {
  return orders
    .filter((o) => (o.order_type || "").trim() === SHOP_TYPE && isInDateRange(o, fromKey, toKey))
    .sort(sortByDeliveryThenId);
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

function polylineMinDistanceToPointMeters(latLngs, latP, lonP) {
  let min = Infinity;
  for (let i = 0; i < latLngs.length - 1; i++) {
    const [lat1, lon1] = latLngs[i];
    const [lat2, lon2] = latLngs[i + 1];
    const d = pointSegmentDistanceMeters(lat1, lon1, lat2, lon2, latP, lonP);
    if (d < min) min = d;
  }
  return min;
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

/**
 * Из ответа OSRM выбрать маршрут, который не заходит в круг `OSRM_DETOUR_BLOCK_*`.
 * Если все заходят — вариант с наибольшим отступом от точки (минимальный «проезд» через зону).
 */
function pickOsrmRouteAvoidingDetourBlock(routes) {
  if (!Array.isArray(routes) || !routes.length) return null;
  /** @type {{ latLngs: Array<[number, number]>, distanceM: number, minD: number }[]} */
  const scored = [];
  for (const r of routes) {
    const latLngs = routeGeometryToLatLngs(r);
    if (!latLngs) continue;
    const distanceM = Number(r.distance);
    if (!Number.isFinite(distanceM)) continue;
    const minD = polylineMinDistanceToPointMeters(latLngs, OSRM_DETOUR_BLOCK_LAT, OSRM_DETOUR_BLOCK_LON);
    scored.push({ latLngs, distanceM: distanceM, minD });
  }
  if (!scored.length) return null;
  const clear = scored.find((s) => s.minD >= OSRM_DETOUR_BLOCK_RADIUS_M);
  if (clear) return { latLngs: clear.latLngs, distanceMeters: clear.distanceM };
  scored.sort((a, b) => b.minD - a.minD);
  return { latLngs: scored[0].latLngs, distanceMeters: scored[0].distanceM };
}

/** Офис → точка: маршрут OSRM (с альтернативами) + км по выбранной геометрии. */
async function osrmFetchDrivingRoutesResolved(fromLon, fromLat, toLon, toLat) {
  const coordStr = `${fromLon},${fromLat};${toLon},${toLat}`;
  const base = `https://router.project-osrm.org/route/v1/driving/${coordStr}`;
  const urls = [
    `${base}?overview=full&geometries=geojson&alternatives=2`,
    `${base}?overview=full&geometries=geojson`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) continue;
      const json = await res.json();
      if (json.code !== "Ok" || !Array.isArray(json.routes) || !json.routes.length) continue;
      return pickOsrmRouteAvoidingDetourBlock(json.routes);
    } catch {
      /* следующий URL */
    }
  }
  return null;
}

/** Одна пара точек: офис → адрес (км по дорогам, OSRM route, с обходом закрытого участка). */
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
    const latLngs = routeGeometryToLatLngs(trip);
    if (!latLngs?.length) return null;
    const distanceM = Number(trip.distance);
    if (!Number.isFinite(distanceM)) return null;
    const waypoints = Array.isArray(json.waypoints) ? json.waypoints : [];
    return { latLngs, distanceM: distanceM, waypoints };
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

function clearRouteDeliveryTripTimeEstimate() {
  const el = document.getElementById("routeSheetRouteTimeEstimate");
  if (!el) return;
  el.textContent = "";
  el.hidden = true;
}

function setRouteDeliveryTripTimeEstimate(text) {
  const el = document.getElementById("routeSheetRouteTimeEstimate");
  if (!el) return;
  if (!text) {
    clearRouteDeliveryTripTimeEstimate();
    return;
  }
  el.textContent = text;
  el.hidden = false;
}

/** Расстояние по дорогам (OSRM), м → примерное время при 20 км/ч. */
function formatApproxTravelTimeAt20Kmh(distanceMeters) {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return "";
  const km = distanceMeters / 1000;
  const hours = km / 20;
  const totalMin = Math.max(1, Math.round(hours * 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const suffix = " (20 км/ч)";
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
    setRouteDeliveryMapStatus("Маршрут по дорогам не найден.", true);
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

async function composeDeliveryRoute() {
  const L = globalThis.L;
  if (!L || !routeDeliveryMap || !routeDeliveryRouteLayer || !routeDeliveryMarkersLayer) {
    setRouteDeliveryMapStatus("Карта ещё не готова. Подождите загрузки точек.", true);
    return;
  }

  const stopsSnapshot = routeDeliveryTripStops.map((s) => ({
    lat: s.lat,
    lon: s.lon,
    ordersHere: s.ordersHere,
  }));
  if (!stopsSnapshot.length) {
    setRouteDeliveryMapStatus(
      "Нет адресов для маршрута: укажите координаты или дождитесь окончания загрузки карты.",
      true,
    );
    return;
  }

  const myGen = ++routeDeliveryComposeGeneration;
  setComposeRouteButtonBusy(true);

  try {
    const picked = await osrmTripDrivingResolved(
      ROUTE_SHEET_OFFICE_LON,
      ROUTE_SHEET_OFFICE_LAT,
      stopsSnapshot,
    );
    if (myGen !== routeDeliveryComposeGeneration) return;
    if (!picked) {
      setRouteDeliveryMapStatus("Не удалось составить маршрут по дорогам. Попробуйте позже.", true);
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

    routeDeliveryComposedRouteActive = true;
    setRouteDeliveryTripTimeEstimate(formatApproxTravelTimeAt20Kmh(distM));

    const b = L.latLngBounds(latLngs);
    b.extend(routeSheetOfficeLatLng(L));
    routeDeliveryMap.fitBounds(b, { padding: [32, 32], maxZoom: 15 });
    setRouteDeliveryMapStatus("");
    scheduleInvalidateRouteDeliveryMap();
  } catch (e) {
    console.error("composeDeliveryRoute:", e);
    if (myGen === routeDeliveryComposeGeneration) {
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
    td.textContent = formatKmCellDisplay(cell);
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
  } catch (e) {
    console.warn("route_sheet_address_geo:", e);
    return null;
  }
}

async function persistRouteSheetAddressGeo(addressKey, lat, lon, kmOffice) {
  if (!addressKey || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
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
  if (error) console.warn("route_sheet_address_geo upsert:", error.message);
}

/** Строка для запроса к Nominatim и ключей кэша — вся строка адреса (без усечения после «-»). */
function addressForNominatimSearch(raw) {
  return String(raw).trim();
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
  }).setView(VOLGOGRAD_CENTER, VOLGOGRAD_ZOOM_DEFAULT);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "",
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
    .map((o) => (o.id != null ? formatOrderIdTypeChip(o.id, o.order_type) : ""))
    .filter(Boolean)
    .join(" · ");
}

function buildDeliveryPopupHtml(ordersAtAddress) {
  return ordersAtAddress
    .map((o) => {
      const num =
        o.id != null ? escapeHtml(formatOrderIdTypeChip(o.id, o.order_type)) : "";
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

    const noGeoOrders = deliveryRows.filter((o) => deliveryPipelineGroupKey(o) === "");
    for (const o of noGeoOrders) deliveryKmByOrderId.set(o.id, /** @type {null} */ (null));
    updateKmCellsForOrders(noGeoOrders);

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
        if (gen !== routeDeliveryPipelineGeneration) return;
        if (km == null) failedOsrm.push(displayAddr || "координаты");
        const kmEntry = makeDeliveryKmEntry(km, coords.lat);
        for (const o of ordersHere) deliveryKmByOrderId.set(o.id, kmEntry);
        updateKmCellsForOrders(ordersHere);
        if (i < orderedKeys.length - 1) await sleep(250);
        continue;
      }

      setRouteDeliveryMapStatus(`Ищем адрес ${x} из ${Y}: ${truncateForStatus(displayAddr, 72)}`, false);

      if (isRouteSheetOfficeAddress(displayAddr)) {
        for (const o of ordersHere) {
          deliveryKmByOrderId.set(o.id, makeDeliveryKmEntry(0, ROUTE_SHEET_OFFICE_LAT));
        }
        updateKmCellsForOrders(ordersHere);
        latLngs.push(officeLL);
        if (i < orderedKeys.length - 1) await sleep(NOMINATIM_DELAY_MS);
        continue;
      }

      let coords = null;
      let km = null;
      const dbKey = routeSheetGeoDbKeyFromDisplayAddress(displayAddr);
      let fromDbFull = false;

      if (dbKey) {
        const cached = await fetchRouteSheetAddressGeoFromDb(dbKey);
        if (gen !== routeDeliveryPipelineGeneration) return;
        if (cached) {
          coords = { lat: cached.lat, lon: cached.lon };
          const memKey = geocodeNominatimCacheKey(addressForNominatimSearch(displayAddr));
          nominatimCache.set(memKey, coords);
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

      if (dbKey && !fromDbFull) {
        void persistRouteSheetAddressGeo(dbKey, coords.lat, coords.lon, km).catch((e) =>
          console.warn("route_sheet_address_geo upsert:", e),
        );
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

/** Как в таблице заказов: user_lite не видит тип «Магазин». */
function ordersVisibleOnRouteSheet() {
  return (state.allOrders || []).filter((o) => !isOrderHiddenFromUserLite(o));
}

/**
 * @param {object} order
 * @param {string} [kmDisplay] если передано — колонка «км» (таблица «Доставка»); иначе без колонки («Самовывоз»).
 * @param {{ includeShipDate?: boolean, includeRemainder?: boolean, includeAddressGeoBtn?: boolean }} [opts] «Дата», «Остаток», домик у адреса — только «Доставка».
 */
function rowMainHtml(order, kmDisplay, opts = {}) {
  const { includeShipDate = false, includeRemainder = false, includeAddressGeoBtn = false } = opts;
  const mosk =
    order.area_m2 != null && order.area_m2 !== "" ? escapeHtml(String(order.area_m2)) : "";
  const konst =
    order.construction_count != null && order.construction_count !== ""
      ? escapeHtml(String(order.construction_count))
      : "";
  const kmTd =
    kmDisplay === undefined
      ? ""
      : `<td class="route-sheet-col-km">${escapeHtml(String(kmDisplay))}</td>`;
  const dateTd = includeShipDate
    ? `<td class="route-sheet-col-date">${escapeHtml(formatDateShortRU(order.delivery_date))}</td>`
    : "";
  const remainderTd =
    includeRemainder && !isOrderPaid(order) && order.remaining_amount != null && order.remaining_amount !== ""
      ? `<td class="route-sheet-col-remainder">${escapeHtml(formatAmount(order.remaining_amount))}</td>`
      : includeRemainder
        ? `<td class="route-sheet-col-remainder">${escapeHtml("-")}</td>`
        : "";
  const clientPlain = order.client ?? "";
  const clientTd = includeShipDate
    ? `<td class="route-sheet-delivery-client"><span class="route-sheet-delivery-clamp-inner" data-fulltext="${escapeAttr(String(clientPlain))}">${escapeHtml(clientPlain)}</span></td>`
    : `<td>${escapeHtml(clientPlain)}</td>`;
  const addressTd = includeAddressGeoBtn
    ? deliveryAddressCellHtml(order, { withDeliveryFullTextAttr: includeShipDate })
    : `<td>${escapeHtml(order.address ?? "")}</td>`;
  let descriptionTd;
  if (includeShipDate) {
    const descDeliveryPlain = routeSheetDeliveryDescriptionFullPlain(order);
    descriptionTd = `<td class="route-sheet-delivery-description"><span class="route-sheet-delivery-clamp-inner" data-fulltext="${escapeAttr(String(descDeliveryPlain))}">${escapeHtml(descDeliveryPlain)}</span></td>`;
  } else {
    descriptionTd = `<td>${escapeHtml(order.description ?? "")}</td>`;
  }
  const hiddenExtra = includeShipDate ? ' class="route-sheet-col-delivery-hidden"' : "";
  return `<tr>
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

function rowShopHtml(order) {
  return `<tr>
    ${orderIdCellHtml(order)}
    <td>${escapeHtml(order.client ?? "")}</td>
    <td>${escapeHtml(order.address ?? "")}</td>
    <td>${escapeHtml(order.description ?? "")}</td>
    <td class="route-sheet-col-phone">${escapeHtml(order.phone ?? "")}</td>
  </tr>`;
}

export function loadRouteSheet() {
  const msgEl = document.getElementById("routeSheetMessage");
  const tbodyDelivery = document.querySelector("#routeSheetTableDelivery tbody");
  const tbodyPickup = document.querySelector("#routeSheetTablePickup tbody");
  const tbodyShop = document.querySelector("#routeSheetTableShop tbody");
  if (!tbodyDelivery || !tbodyPickup || !tbodyShop) return;

  closeOrderIdActionsMenu();

  const { fromKey, toKey, valid } = getRangeFromDom();
  if (!valid) {
    if (msgEl) msgEl.textContent = "Укажите даты «с» и «по» в формате ГГГГ-ММ-ДД.";
    tbodyDelivery.innerHTML = "";
    tbodyPickup.innerHTML = "";
    tbodyShop.innerHTML = "";
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
    tbodyShop.innerHTML = "";
    routeDeliveryPipelineGeneration += 1;
    routeDeliveryComposeGeneration += 1;
    deliveryKmByOrderId.clear();
    clearRouteDeliveryMarkersAndRoadRoute();
    setRouteDeliveryMapStatus("");
    return;
  }

  if (msgEl) msgEl.textContent = "";

  const orders = ordersVisibleOnRouteSheet();
  const deliveryRows = filterMainOrdersByShipment(orders, fromKey, toKey, DELIVERY_SHIP);
  const pickupRows = filterMainOrdersByShipment(orders, fromKey, toKey, DELIVERY_PICKUP);
  const shop = filterShopOrders(orders, fromKey, toKey);

  tbodyPickup.innerHTML = pickupRows.map((o) => rowMainHtml(o)).join("");
  tbodyShop.innerHTML = shop.map(rowShopHtml).join("");

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
  }
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

function rowDeliveryMainValues(order) {
  const kmEntry = deliveryKmByOrderId.get(order.id);
  const kmCell = formatKmCellDisplay(kmEntry);
  return [
    order.id != null ? formatOrderIdTypeChip(order.id, order.order_type) : "",
    formatDateShortRU(order.delivery_date),
    order.client ?? "",
    order.address ?? "",
    kmCell,
    routeSheetDeliveryDescriptionFullPlain(order),
    !isOrderPaid(order) && order.remaining_amount != null && order.remaining_amount !== ""
      ? formatAmount(order.remaining_amount)
      : "-",
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

/** При уходе с раздела — отменить фоновое геокодирование и очистить маркеры. */
export function bumpRouteDeliveryMapGeneration() {
  routeDeliveryPipelineGeneration += 1;
  routeDeliveryComposeGeneration += 1;
  deliveryKmByOrderId.clear();
  clearRouteDeliveryMarkersAndRoadRoute();
  setRouteDeliveryMapStatus("");
}

export function exportRouteSheetDeliveryExcel() {
  const { fromKey, toKey, valid } = getRangeFromDom();
  if (!valid || fromKey > toKey) return;
  const list = filterMainOrdersByShipment(ordersVisibleOnRouteSheet(), fromKey, toKey, DELIVERY_SHIP);
  const rows = list.map(rowDeliveryMainValues);
  exportSheet(HEADERS_DELIVERY, rows, "Доставка", "marshrutnyy_list_dostavka");
}

export function exportRouteSheetPickupExcel() {
  const { fromKey, toKey, valid } = getRangeFromDom();
  if (!valid || fromKey > toKey) return;
  const list = filterMainOrdersByShipment(ordersVisibleOnRouteSheet(), fromKey, toKey, DELIVERY_PICKUP);
  const rows = list.map(rowMainValues);
  exportSheet(HEADERS_MAIN, rows, "Самовывоз", "marshrutnyy_list_samovyvoz");
}

export function exportRouteSheetShopExcel() {
  const { fromKey, toKey, valid } = getRangeFromDom();
  if (!valid || fromKey > toKey) return;
  const shop = filterShopOrders(ordersVisibleOnRouteSheet(), fromKey, toKey);
  const rows = shop.map(rowShopValues);
  exportSheet(HEADERS_SHOP, rows, "Магазин", "marshrutnyy_list_magazin");
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
  routeSheetAddressGeoPopoverState.saveAllowed = false;
  routeSheetAddressGeoPopoverState.previousCoordinates = "";
}

function positionRouteSheetAddressGeoPopover(anchorBtn) {
  const pop = document.getElementById("routeSheetAddressGeoPopover");
  if (!pop || !anchorBtn) return;
  const tr = anchorBtn.closest("tr");
  const rect = (tr || anchorBtn).getBoundingClientRect();
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

function openRouteSheetAddressGeoPopover(anchorBtn) {
  const orderIdRaw = anchorBtn.getAttribute("data-order-id");
  const orderId = orderIdRaw != null && orderIdRaw !== "" ? Number(orderIdRaw) : NaN;
  if (!Number.isFinite(orderId)) return;

  const order = (state.allOrders || []).find((o) => Number(o.id) === orderId);
  clearRouteSheetAddressGeoPopoverFields();
  routeSheetAddressGeoPopoverState.orderId = orderId;
  routeSheetAddressGeoPopoverState.previousCoordinates =
    order?.coordinates != null && String(order.coordinates).trim() !== "" ? String(order.coordinates).trim() : "";
  routeSheetAddressGeoPopoverState.saveAllowed =
    Boolean(order) && canMutateOrders() && !isOrderEditLockedForUserLite(order);

  const inp = document.getElementById("routeSheetAddressGeoInput");
  if (inp) inp.value = routeSheetAddressGeoPopoverState.previousCoordinates;

  positionRouteSheetAddressGeoPopover(anchorBtn);
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
  if (e.target.closest?.(".route-sheet-address-geo-open")) return;
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
    const btn = e.target.closest(".route-sheet-address-geo-open");
    if (!btn || !section.contains(btn)) return;
    e.preventDefault();
    e.stopPropagation();
    openRouteSheetAddressGeoPopover(btn);
  });

  const saveBtn = document.getElementById("routeSheetAddressGeoSaveBtn");

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

      const oid = routeSheetAddressGeoPopoverState.orderId;
      if (!Number.isFinite(oid)) return;

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
        closeRouteSheetAddressGeoPopover();
        setMessage("Координаты сохранены", "#2e7d32");
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

  const routeSheetSection = document.getElementById("section-route-sheet");
  if (routeSheetSection && !routeSheetSection.dataset.routeSheetOrderIdMenuBound) {
    routeSheetSection.dataset.routeSheetOrderIdMenuBound = "1";
    routeSheetSection.addEventListener("click", (e) => {
      const idTd = e.target.closest("td.td-order-id");
      if (!idTd || !routeSheetSection.contains(idTd)) return;
      e.stopPropagation();
      e.preventDefault();
      openOrderIdActionsMenu(idTd);
    });
  }

  const deliveryBtn = document.getElementById("routeSheetExportDeliveryBtn");
  const pickupBtn = document.getElementById("routeSheetExportPickupBtn");
  const shopBtn = document.getElementById("routeSheetExportShopBtn");
  if (deliveryBtn && !deliveryBtn.dataset.routeSheetBound) {
    deliveryBtn.dataset.routeSheetBound = "1";
    deliveryBtn.addEventListener("click", () => exportRouteSheetDeliveryExcel());
  }
  if (pickupBtn && !pickupBtn.dataset.routeSheetBound) {
    pickupBtn.dataset.routeSheetBound = "1";
    pickupBtn.addEventListener("click", () => exportRouteSheetPickupExcel());
  }
  if (shopBtn && !shopBtn.dataset.routeSheetBound) {
    shopBtn.dataset.routeSheetBound = "1";
    shopBtn.addEventListener("click", () => exportRouteSheetShopExcel());
  }

  const composeRouteBtn = document.getElementById("routeSheetComposeRouteBtn");
  if (composeRouteBtn && !composeRouteBtn.dataset.routeSheetBound) {
    composeRouteBtn.dataset.routeSheetBound = "1";
    composeRouteBtn.addEventListener("click", () => void composeDeliveryRoute());
  }

  initRouteSheetAddressGeoPopover();
  loadRouteSheet();
}
