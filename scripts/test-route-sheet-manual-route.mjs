import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const routeSource = await readFile(new URL("../js/route-sheet.js", import.meta.url), "utf8");
const styleSource = await readFile(new URL("../style.css", import.meta.url), "utf8");
const swSource = await readFile(new URL("../sw.js", import.meta.url), "utf8");

assert.match(indexSource, /id="routeSheetComposeRouteBtn"[\s\S]*id="routeSheetRefreshRouteBtn"/);
assert.match(indexSource, />\s*Обновить маршрут\s*</);
assert.match(routeSource, /function getManualDeliveryRoutePlan\(\)/);
assert.match(routeSource, /numberedRows\.sort\(\(a, b\) => a\.pointNum - b\.pointNum/);
assert.match(routeSource, /async function osrmDrivingRouteInGivenOrder/);
assert.match(routeSource, /for \(const stop of stops\)/);
assert.match(routeSource, /deliveryMapMarkerIconNumbered\(L, stop\.ordersHere, stop\.pointNum\)/);
assert.match(routeSource, /formatApproxTravelTimeAt20Kmh\(picked\.distanceM, plan\.orderedStops\.length\)/);
assert.match(routeSource, /refreshRouteBtn\.addEventListener\("click"/);
assert.match(styleSource, /\.route-sheet-refresh-route-btn/);
assert.match(swSource, /orders-site-static-v69/);

console.log("route sheet manual route tests: ok");
