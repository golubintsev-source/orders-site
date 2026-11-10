import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const routeSource = await readFile(new URL("../js/route-sheet.js", import.meta.url), "utf8");
const autocompleteSource = await readFile(new URL("../js/clientAutocomplete.js", import.meta.url), "utf8");
const migrationSource = await readFile(new URL("../supabase_route_sheet_manual_points.sql", import.meta.url), "utf8");
const serviceWorkerSource = await readFile(new URL("../sw.js", import.meta.url), "utf8");

assert.match(routeSource, /const ROUTE_SHEET_POINTS_TABLE = "route_sheet_manual_points"/);
assert.match(routeSource, /async function loadRouteSheetManualFromDatabase\(\)/);
assert.match(routeSource, /\.from\(ROUTE_SHEET_POINTS_TABLE\)[\s\S]*?\.insert\(/);
assert.match(routeSource, /\.from\(ROUTE_SHEET_POINTS_TABLE\)[\s\S]*?\.update\(/);
assert.doesNotMatch(routeSource, /sessionStorage/);

const pointsIndex = routeSource.indexOf("const points = sourceSuggestions(routeSheetManualDeliveryOrders");
const ordersIndex = routeSource.indexOf("const orders = sourceSuggestions(state.allOrders");
assert.ok(pointsIndex >= 0 && ordersIndex > pointsIndex, "Saved route points must precede orders");
assert.match(routeSource, /for \(const item of \[\.\.\.\(localItems \|\| \[\]\), \.\.\.\(remoteItems \|\| \[\]\)\]\)/);
assert.match(autocompleteSource, /getLocalSuggestions = localAddressSuggestions/);
assert.match(autocompleteSource, /mergeSuggestions = mergeAddressSuggestions/);

assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS public\.route_sheet_manual_points/);
assert.match(migrationSource, /ALTER TABLE public\.route_sheet_manual_points ENABLE ROW LEVEL SECURITY/);
assert.match(migrationSource, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.route_sheet_manual_points TO authenticated/);
assert.match(migrationSource, /REVOKE ALL ON TABLE public\.route_sheet_manual_points FROM anon/);
assert.match(serviceWorkerSource, /orders-site-static-v147/);

console.log("route sheet points database tests: ok");
