import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

test("calculations standalone init is excluded from SPA", () => {
  const code = read("js/calculations.js");
  assert.match(code, /if \(document\.getElementById\("section-calculations"\) == null\)/);
  assert.match(code, /generation !== calculationsLoadGeneration/);
});

test("orders are not eagerly loaded on every route", () => {
  const code = read("js/main.js");
  assert.match(code, /needsOrdersOnBoot \? loadOrders\(\) : Promise\.resolve\(\)/);
  assert.match(code, /pendingOrderId != null/);
});

test("concurrent orders requests are coalesced", () => {
  const code = read("js/orders.js");
  assert.match(code, /if \(ordersLoadInFlight\) return ordersLoadInFlight/);
});

test("PWA does not forcibly take over active clients", () => {
  const code = read("sw.js");
  assert.doesNotMatch(code, /await self\.skipWaiting\(\)/);
  assert.doesNotMatch(code, /await self\.clients\.claim\(\)/);
  assert.match(code, /cacheFirstVersioned\(request\)/);
});

test("read timeouts remain separate from offline write queue", () => {
  const code = read("js/offline-cache.js");
  assert.match(code, /export function raceReadWithTimeout/);
  assert.match(code, /export function raceWithTimeout/);
  assert.match(code, /if \(!isOfflineWorkModeEnabled\(\)\) return Promise.resolve\(promise\)/);
  const orders = read("js/orders.js");
  assert.match(orders, /savedOrderId = await raceWithTimeout\(/);
  assert.match(orders, /const res = await raceReadWithTimeout\(/);
  assert.match(code, /export const OFFLINE_SUPABASE_WAIT_MS/);
});
