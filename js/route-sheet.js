import { state } from "./state.js";
import { isOrderEditLockedForUserLite, isOrderHiddenFromUserLite, isUserLite } from "./roles.js";
import { formatOrderIdTypeChip, formatDateShortRU, formatAmount } from "./format.js";
import { isOrderPaid } from "./orders.js";
import { closeOrderIdActionsMenu, openOrderIdActionsMenu } from "./ui.js";
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
/** Одна очередь: карта доставки + км; инкремент отменяет текущий проход. */
let routeDeliveryPipelineGeneration = 0;
/** Отмена отрисовки маршрута при новом клике / сбросе карты. */
let routeRoadDrawGeneration = 0;
/** Км от офиса по `order.id` (число км или null). */
const deliveryKmByOrderId = new Map();
const nominatimCache = new Map();

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

function formatKmCellDisplay(km) {
  if (km == null || !Number.isFinite(km)) return "—";
  const rounded = Math.round(km * 10) / 10;
  if (rounded === 0) return "0";
  return String(rounded).replace(".", ",");
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

function invalidateRoadRouteDraw() {
  routeRoadDrawGeneration += 1;
}

function clearRouteDeliveryRoadRouteLayer() {
  routeDeliveryRouteLayer?.clearLayers();
}

function clearRouteDeliveryMarkersAndRoadRoute() {
  invalidateRoadRouteDraw();
  routeDeliveryMarkersLayer?.clearLayers();
  clearRouteDeliveryRoadRouteLayer();
}

/** По клику на маркер доставки: линия офис → точка по OSRM. */
async function showDeliveryRoadRouteFromOffice(destLatLng) {
  const L = globalThis.L;
  if (!L || !routeDeliveryRouteLayer || !destLatLng) return;
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
    const km = order != null ? deliveryKmByOrderId.get(order.id) : undefined;
    td.textContent = formatKmCellDisplay(km);
  }
}

function geocodeNominatimCacheKey(normalizedQuery) {
  return `v3|${String(normalizedQuery).trim().toLowerCase()}`;
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

/** Для Nominatim: убрать квартиру/этаж после первого «-» (и сам дефис). Полный адрес в таблице не меняется. */
function addressForNominatimSearch(raw) {
  const t = String(raw).trim();
  if (!t) return "";
  const i = t.indexOf("-");
  if (i === -1) return t;
  return t.slice(0, i).trim();
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
 * Кэш с префиксом v3| — после смены логики старые значения не подхватываются.
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

    clearRouteDeliveryMarkersAndRoadRoute();
    deliveryKmByOrderId.clear();

    const noAddrOrders = deliveryRows.filter((o) => addressNormKeyFromOrder(o) === "");
    for (const o of noAddrOrders) deliveryKmByOrderId.set(o.id, null);
    updateKmCellsForOrders(noAddrOrders);

    const withAddr = deliveryRows.filter((o) => String(o.address ?? "").trim() !== "");
    if (withAddr.length === 0) {
      routeDeliveryMap.setView(VOLGOGRAD_CENTER, VOLGOGRAD_ZOOM_DEFAULT);
      setRouteDeliveryMapStatus("");
      scheduleInvalidateRouteDeliveryMap();
      return;
    }

    const officeLL = routeSheetOfficeLatLng(L);
    const withAddrForMap = withAddr.filter((o) => !isRouteSheetOfficeAddress(o.address));

    /** @type {Map<string, object[]>} */
    const byAddress = new Map();
    for (const o of withAddr) {
      const k = addressNormKeyFromOrder(o);
      if (!byAddress.has(k)) byAddress.set(k, []);
      byAddress.get(k).push(o);
    }

    const orderedKeys = [];
    const keySeen = new Set();
    for (const o of deliveryRows) {
      const k = addressNormKeyFromOrder(o);
      if (k === "" || keySeen.has(k)) continue;
      keySeen.add(k);
      orderedKeys.push(k);
    }
    const Y = orderedKeys.length;
    const failedGeocode = [];
    const failedOsrm = [];
    const latLngs = [];

    if (withAddrForMap.length === 0) {
      for (const o of withAddr) {
        if (isRouteSheetOfficeAddress(o.address)) deliveryKmByOrderId.set(o.id, 0);
        else deliveryKmByOrderId.set(o.id, null);
      }
      updateKmCellsForOrders(withAddr);
      routeDeliveryMap.setView(officeLL, 15);
      setRouteDeliveryMapStatus("");
      scheduleInvalidateRouteDeliveryMap();
      return;
    }

    for (let i = 0; i < orderedKeys.length; i++) {
      if (gen !== routeDeliveryPipelineGeneration) return;
      const key = orderedKeys[i];
      const ordersHere = byAddress.get(key) || [];
      const displayAddr = (ordersHere[0]?.address ?? "").trim();
      const x = i + 1;
      setRouteDeliveryMapStatus(`Ищем адрес ${x} из ${Y}: ${truncateForStatus(displayAddr, 72)}`, false);

      if (isRouteSheetOfficeAddress(displayAddr)) {
        for (const o of ordersHere) deliveryKmByOrderId.set(o.id, 0);
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
        for (const o of ordersHere) deliveryKmByOrderId.set(o.id, null);
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
        marker.on("popupopen", () => {
          void showDeliveryRoadRouteFromOffice(marker.getLatLng());
        });
        marker.addTo(routeDeliveryMarkersLayer);
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
      for (const o of ordersHere) deliveryKmByOrderId.set(o.id, km);
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
 * @param {{ includeShipDate?: boolean, includeRemainder?: boolean }} [opts] «Дата» и «Остаток» — только таблица «Доставка».
 */
function rowMainHtml(order, kmDisplay, opts = {}) {
  const { includeShipDate = false, includeRemainder = false } = opts;
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
  return `<tr>
    ${orderIdCellHtml(order)}
    ${dateTd}
    <td>${escapeHtml(order.client ?? "")}</td>
    <td>${escapeHtml(order.address ?? "")}</td>
    ${kmTd}
    <td>${escapeHtml(order.description ?? "")}</td>
    ${remainderTd}
    <td>${mosk}</td>
    <td>${konst}</td>
    <td>${escapeHtml(boolDaNet(order.installation))}</td>
    <td>${escapeHtml(boolDaNet(order.reveals))}</td>
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
      .map((o) => rowMainHtml(o, "…", { includeShipDate: true, includeRemainder: true }))
      .join("");
    void runDeliveryPipeline(deliveryRows, gen);
  } else {
    routeDeliveryPipelineGeneration += 1;
    deliveryKmByOrderId.clear();
    clearRouteDeliveryMarkersAndRoadRoute();
    tbodyDelivery.innerHTML = deliveryRows
      .map((o) => rowMainHtml(o, "—", { includeShipDate: true, includeRemainder: true }))
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
  const km = deliveryKmByOrderId.get(order.id);
  const kmCell = km != null && Number.isFinite(km) ? Math.round(km * 10) / 10 : "";
  return [
    order.id != null ? formatOrderIdTypeChip(order.id, order.order_type) : "",
    formatDateShortRU(order.delivery_date),
    order.client ?? "",
    order.address ?? "",
    kmCell,
    order.description ?? "",
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

  loadRouteSheet();
}
