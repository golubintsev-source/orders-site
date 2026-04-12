import { state } from "./state.js";
import { isOrderEditLockedForUserLite, isOrderHiddenFromUserLite, isUserLite } from "./roles.js";
import { formatOrderIdTypeChip } from "./format.js";
import { closeOrderIdActionsMenu, openOrderIdActionsMenu } from "./ui.js";

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
  "Клиент",
  "Адрес",
  "км",
  "Описание",
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

function normalizeAddrForOfficeCompare(s) {
  return String(s).trim().toLowerCase().replace(/\s+/g, " ");
}

/** Постоянная метка офиса (координаты по OSM / Nominatim для здания). */
const ROUTE_SHEET_OFFICE_ADDRESS = "Автотранспортная улица, 29Ж";
const ROUTE_SHEET_OFFICE_ADDR_NORM = normalizeAddrForOfficeCompare(ROUTE_SHEET_OFFICE_ADDRESS);
const ROUTE_SHEET_OFFICE_LAT = 48.6903978;
const ROUTE_SHEET_OFFICE_LON = 44.4336316;
/** Тот же файл, что на форме входа (`login.html`). */
const ROUTE_SHEET_LOGIN_LOGO_PATH = "./img/logo.png";

let routeDeliveryMap = null;
let routeDeliveryOfficeLayer = null;
let routeDeliveryMarkersLayer = null;
let routeDeliveryMapGeneration = 0;
/** Инкремент при новой загрузке маршрутного листа / уходе с раздела — отмена расчёта «км». */
let routeDeliveryKmGeneration = 0;
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

/**
 * Расстояние по дорогам офис → адреса (OSRM public, один запрос table).
 * @returns {Promise<Map<string, number|null>>} ключ — нормализованный адрес, значение — км или null
 */
async function computeKmByAddressNormFromOffice(deliveryRows, gen) {
  /** @type {Map<string, number|null>} */
  const out = new Map();
  const uniqueKeys = [
    ...new Set(deliveryRows.map((o) => addressNormKeyFromOrder(o)).filter((k) => k !== "")),
  ];

  for (const key of uniqueKeys) {
    if (isRouteSheetOfficeAddress(key)) out.set(key, 0);
  }

  const needGeocode = uniqueKeys.filter((k) => !out.has(k));
  /** @type {{ key: string; lat: number; lon: number }[]} */
  const destList = [];

  for (let i = 0; i < needGeocode.length; i++) {
    if (gen !== routeDeliveryKmGeneration) return out;
    const key = needGeocode[i];
    const order = deliveryRows.find((o) => addressNormKeyFromOrder(o) === key);
    const rawAddr = order?.address ?? "";
    const coords = await geocodeAddressVolgograd(rawAddr);
    if (gen !== routeDeliveryKmGeneration) return out;
    if (!coords) {
      out.set(key, null);
    } else {
      destList.push({ key, lat: coords.lat, lon: coords.lon });
    }
    if (i < needGeocode.length - 1) await sleep(NOMINATIM_DELAY_MS);
  }

  if (gen !== routeDeliveryKmGeneration) return out;
  if (destList.length === 0) return out;

  const CHUNK = 45;
  for (let start = 0; start < destList.length; start += CHUNK) {
    if (gen !== routeDeliveryKmGeneration) return out;
    const chunk = destList.slice(start, start + CHUNK);
    const coordStr = [
      `${ROUTE_SHEET_OFFICE_LON},${ROUTE_SHEET_OFFICE_LAT}`,
      ...chunk.map((d) => `${d.lon},${d.lat}`),
    ].join(";");
    const destIdx = chunk.map((_, i) => i + 1).join(";");
    const url = `https://router.project-osrm.org/table/v1/driving/${coordStr}?sources=0&destinations=${destIdx}&annotations=distance`;

    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (gen !== routeDeliveryKmGeneration) return out;
      if (!res.ok) {
        for (const d of chunk) out.set(d.key, null);
        continue;
      }
      const json = await res.json();
      if (gen !== routeDeliveryKmGeneration) return out;
      if (json.code !== "Ok" || !Array.isArray(json.distances) || !Array.isArray(json.distances[0])) {
        for (const d of chunk) out.set(d.key, null);
        continue;
      }
      const row = json.distances[0];
      for (let j = 0; j < chunk.length; j++) {
        const meters = row[j];
        if (meters == null || !Number.isFinite(meters)) out.set(chunk[j].key, null);
        else out.set(chunk[j].key, meters / 1000);
      }
    } catch {
      for (const d of chunk) out.set(d.key, null);
    }
  }
  return out;
}

async function fillDeliveryDistanceColumn(deliveryRows, gen) {
  deliveryKmByOrderId.clear();
  const kmByAddr = await computeKmByAddressNormFromOffice(deliveryRows, gen);
  if (gen !== routeDeliveryKmGeneration) return;

  for (const o of deliveryRows) {
    const k = addressNormKeyFromOrder(o);
    if (k === "") {
      deliveryKmByOrderId.set(o.id, null);
      continue;
    }
    const km = kmByAddr.get(k);
    deliveryKmByOrderId.set(o.id, km === undefined ? null : km);
  }

  const tbody = document.querySelector("#routeSheetTableDelivery tbody");
  if (!tbody || gen !== routeDeliveryKmGeneration) return;
  const rows = tbody.querySelectorAll("tr");
  deliveryRows.forEach((order, i) => {
    const td = rows[i]?.querySelector("td.route-sheet-col-km");
    if (!td) return;
    const v = deliveryKmByOrderId.get(order.id);
    td.textContent = formatKmCellDisplay(v);
  });
}

function nominatimQueryForAddress(address) {
  const t = String(address).trim();
  if (!t) return "";
  const lower = t.toLowerCase();
  if (lower.includes("волгоград")) return `${t}, Россия`;
  return `${t}, Волгоград, Россия`;
}

/**
 * Геокодирование адреса (Nominatim). Кэш и пауза между запросами — по правилам использования API.
 * @returns {Promise<{ lat: number, lon: number } | null>}
 */
async function geocodeAddressVolgograd(address) {
  const raw = String(address).trim();
  if (!raw) return null;
  const key = raw.toLowerCase();
  if (nominatimCache.has(key)) return nominatimCache.get(key);

  const q = nominatimQueryForAddress(raw);
  const params = new URLSearchParams({ q, format: "json", limit: "1", countrycodes: "ru" });
  const url = `https://nominatim.openstreetmap.org/search?${params}`;
  const res = await fetch(url, { headers: { "Accept-Language": "ru,en" } });
  if (!res.ok) {
    nominatimCache.set(key, null);
    return null;
  }
  const data = await res.json();
  if (!Array.isArray(data) || !data[0]) {
    nominatimCache.set(key, null);
    return null;
  }
  const lat = Number.parseFloat(data[0].lat);
  const lon = Number.parseFloat(data[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    nominatimCache.set(key, null);
    return null;
  }
  const coords = { lat, lon };
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
  const html = `<div class="route-sheet-map-office-wrap"><img class="route-sheet-map-office-logo" src="${escapeAttr(ROUTE_SHEET_LOGIN_LOGO_PATH)}" alt="" width="10" height="10" decoding="async" /></div>`;
  const icon = L.divIcon({
    className: "route-sheet-map-divicon-root route-sheet-map-office-divicon",
    html,
    iconSize: [10, 10],
    iconAnchor: [5, 10],
    popupAnchor: [0, -10],
  });
  const m = L.marker(latlng, { icon, zIndexOffset: -200 });
  m.bindPopup(
    `<div class="route-sheet-map-popup-order"><strong>${escapeHtml(ROUTE_SHEET_OFFICE_ADDRESS)}</strong><br><span class="route-sheet-map-popup-addr">Волгоград</span></div>`,
  );
  m.addTo(routeDeliveryOfficeLayer);
}

function ensureRouteDeliveryMap() {
  const L = globalThis.L;
  const el = document.getElementById("routeSheetDeliveryMap");
  if (!L || !el || routeDeliveryMap) return;

  routeDeliveryMap = L.map(el, { scrollWheelZoom: false }).setView(VOLGOGRAD_CENTER, VOLGOGRAD_ZOOM_DEFAULT);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(routeDeliveryMap);
  routeDeliveryOfficeLayer = L.layerGroup().addTo(routeDeliveryMap);
  addRouteSheetOfficeMarker(L);
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
 * Точки доставки на карте Волгограда (по адресам из таблицы «Доставка»).
 * @param {Array<object>} deliveryRows
 */
async function updateRouteSheetDeliveryMap(deliveryRows) {
  const gen = ++routeDeliveryMapGeneration;
  const L = globalThis.L;
  if (!L) {
    setRouteDeliveryMapStatus("Библиотека карты не загружена. Обновите страницу.", true);
    return;
  }

  ensureRouteDeliveryMap();
  if (!routeDeliveryMap || !routeDeliveryMarkersLayer) return;

  routeDeliveryMarkersLayer.clearLayers();
  setRouteDeliveryMapStatus("");

  const officeLL = routeSheetOfficeLatLng(L);

  const withAddr = deliveryRows.filter((o) => String(o.address ?? "").trim() !== "");
  if (withAddr.length === 0) {
    routeDeliveryMap.setView(VOLGOGRAD_CENTER, VOLGOGRAD_ZOOM_DEFAULT);
    scheduleInvalidateRouteDeliveryMap();
    return;
  }

  const withAddrForMap = withAddr.filter((o) => !isRouteSheetOfficeAddress(o.address));
  if (withAddrForMap.length === 0) {
    routeDeliveryMap.setView(officeLL, 15);
    scheduleInvalidateRouteDeliveryMap();
    setRouteDeliveryMapStatus("");
    return;
  }

  /** @type {Map<string, object[]>} */
  const byAddress = new Map();
  for (const o of withAddrForMap) {
    const k = String(o.address).trim().toLowerCase();
    if (!byAddress.has(k)) byAddress.set(k, []);
    byAddress.get(k).push(o);
  }
  const uniqueAddresses = [...byAddress.keys()].map((k) => byAddress.get(k)[0].address.trim());

  setRouteDeliveryMapStatus("Ищем адреса на карте…");
  const failed = [];
  const latLngs = [];

  for (let i = 0; i < uniqueAddresses.length; i++) {
    if (gen !== routeDeliveryMapGeneration) return;
    const addr = uniqueAddresses[i];
    const coords = await geocodeAddressVolgograd(addr);
    if (gen !== routeDeliveryMapGeneration) return;
    if (!coords) {
      failed.push(addr);
      continue;
    }
    const ordersHere = byAddress.get(addr.toLowerCase()) || [];
    const latlng = L.latLng(coords.lat, coords.lon);
    latLngs.push(latlng);
    const marker = L.marker(latlng, {
      icon: deliveryMapMarkerIcon(L, ordersHere),
    });
    marker.bindPopup(buildDeliveryPopupHtml(ordersHere));
    marker.addTo(routeDeliveryMarkersLayer);
    if (i < uniqueAddresses.length - 1) await sleep(NOMINATIM_DELAY_MS);
  }

  if (gen !== routeDeliveryMapGeneration) return;

  if (latLngs.length === 1) {
    routeDeliveryMap.fitBounds(L.latLngBounds([latLngs[0], officeLL]), { padding: [36, 36], maxZoom: 15 });
  } else if (latLngs.length > 1) {
    const b = L.latLngBounds(latLngs);
    b.extend(officeLL);
    routeDeliveryMap.fitBounds(b, { padding: [28, 28], maxZoom: 15 });
  } else {
    routeDeliveryMap.setView(VOLGOGRAD_CENTER, VOLGOGRAD_ZOOM_DEFAULT);
  }

  if (failed.length) {
    const sample = failed.slice(0, 3).join("; ");
    const more = failed.length > 3 ? ` (+${failed.length - 3})` : "";
    setRouteDeliveryMapStatus(`Не удалось найти на карте: ${sample}${more}`, true);
  } else {
    setRouteDeliveryMapStatus("");
  }

  scheduleInvalidateRouteDeliveryMap();
}

/** Как в таблице заказов: user_lite не видит тип «Магазин». */
function ordersVisibleOnRouteSheet() {
  return (state.allOrders || []).filter((o) => !isOrderHiddenFromUserLite(o));
}

/**
 * @param {object} order
 * @param {string} [kmDisplay] если передано — колонка «км» (таблица «Доставка»); иначе без колонки («Самовывоз»).
 */
function rowMainHtml(order, kmDisplay) {
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
  return `<tr>
    ${orderIdCellHtml(order)}
    <td>${escapeHtml(order.client ?? "")}</td>
    <td>${escapeHtml(order.address ?? "")}</td>
    ${kmTd}
    <td>${escapeHtml(order.description ?? "")}</td>
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
    routeDeliveryMapGeneration += 1;
    routeDeliveryKmGeneration += 1;
    deliveryKmByOrderId.clear();
    if (routeDeliveryMarkersLayer) routeDeliveryMarkersLayer.clearLayers();
    setRouteDeliveryMapStatus("");
    return;
  }
  if (fromKey > toKey) {
    if (msgEl) msgEl.textContent = "Дата «с» не может быть позже даты «по».";
    tbodyDelivery.innerHTML = "";
    tbodyPickup.innerHTML = "";
    tbodyShop.innerHTML = "";
    routeDeliveryMapGeneration += 1;
    routeDeliveryKmGeneration += 1;
    deliveryKmByOrderId.clear();
    if (routeDeliveryMarkersLayer) routeDeliveryMarkersLayer.clearLayers();
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
    const kmGen = ++routeDeliveryKmGeneration;
    tbodyDelivery.innerHTML = deliveryRows.map((o) => rowMainHtml(o, "…")).join("");
    void fillDeliveryDistanceColumn(deliveryRows, kmGen);
    void updateRouteSheetDeliveryMap(deliveryRows);
  } else {
    routeDeliveryKmGeneration += 1;
    deliveryKmByOrderId.clear();
    tbodyDelivery.innerHTML = deliveryRows.map((o) => rowMainHtml(o, "—")).join("");
    routeDeliveryMapGeneration += 1;
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
    order.client ?? "",
    order.address ?? "",
    kmCell,
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

/** При уходе с раздела — отменить фоновое геокодирование и очистить маркеры. */
export function bumpRouteDeliveryMapGeneration() {
  routeDeliveryMapGeneration += 1;
  routeDeliveryKmGeneration += 1;
  deliveryKmByOrderId.clear();
  if (routeDeliveryMarkersLayer) routeDeliveryMarkersLayer.clearLayers();
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
