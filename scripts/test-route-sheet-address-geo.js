/**
 * Проверка ключа справочника адрес→координаты и подстановки из кэша.
 * Запуск: node scripts/test-route-sheet-address-geo.js
 *
 * Зеркалит addressForNominatimSearch / routeSheetGeoDbKeyFromDisplayAddress /
 * applyAddressGeoCacheToOrders (без DOM/Supabase).
 */

function addressForNominatimSearch(raw) {
  const t = String(raw).trim();
  if (!t) return "";
  const cut = t.indexOf("//");
  if (cut === -1) return t;
  return t.slice(0, cut).trim();
}

function routeSheetGeoDbKeyFromDisplayAddress(displayAddr) {
  const searchAddr = addressForNominatimSearch(String(displayAddr).trim());
  const k = String(searchAddr).trim().toLowerCase();
  return k || null;
}

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

function orderHasSavedCoordinates(order) {
  return parseLatLonCommaInput(order?.coordinates) != null;
}

function applyAddressGeoCacheToOrders(orders, geoMap) {
  if (!orders?.length || !geoMap?.size) return;
  for (const o of orders) {
    if (!o || orderHasSavedCoordinates(o)) continue;
    const k = routeSheetGeoDbKeyFromDisplayAddress(o.address);
    if (!k) continue;
    const cached = geoMap.get(k);
    if (!cached) continue;
    o.coordinates = formatCoordinatesForStorage(cached);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(routeSheetGeoDbKeyFromDisplayAddress("  Ул. Ленина 10  ") === "ул. ленина 10", "trim+lower");
assert(
  routeSheetGeoDbKeyFromDisplayAddress("Ул. Ленина 10 // кв 5") === "ул. ленина 10",
  "strip after //",
);
assert(
  routeSheetGeoDbKeyFromDisplayAddress("Ул. Ленина 10 // кв 5") ===
    routeSheetGeoDbKeyFromDisplayAddress("ул. ленина 10 // офис"),
  "same building shares key",
);
assert(routeSheetGeoDbKeyFromDisplayAddress("  // кв 1") == null, "only suffix is not a key");
assert(routeSheetGeoDbKeyFromDisplayAddress("") == null, "empty address");

const geoMap = new Map([
  ["ул. ленина 10", { lat: 48.753016, lon: 44.495766, km_office: 3.2 }],
]);

const known = { id: 1, address: "Ул. Ленина 10 // кв 2" };
const other = { id: 2, address: "Другая 1" };
const already = { id: 3, address: "Ул. Ленина 10", coordinates: "48.1, 44.1" };

applyAddressGeoCacheToOrders([known, other, already], geoMap);

assert(parseLatLonCommaInput(known.coordinates)?.lat === 48.753016, "hydrate from dictionary");
assert(other.coordinates == null, "unknown address stays empty");
assert(already.coordinates === "48.1, 44.1", "do not overwrite saved coordinates");

console.log("ok: route-sheet address geo dictionary");
