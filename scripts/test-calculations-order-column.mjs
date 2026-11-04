import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  formatCalcDisplayComment,
  parseOrderDeltaCommentOrderChip,
  parseOrderDeltaCommentOrderId,
} from "../js/calculations-format.js";

const root = new URL("../", import.meta.url);
const calculations = await readFile(new URL("js/calculations.js", root), "utf8");
const orders = await readFile(new URL("js/orders.js", root), "utf8");
const offline = await readFile(new URL("js/offline-cache.js", root), "utf8");
const migration = await readFile(new URL("supabase_calculations_order_id.sql", root), "utf8");

const legacy = "[AUTO_ORDER_DELTA] Остаток; 0123_О; Иван; Ленина 1; сумма 5000; 12:30; Алексей";
assert.equal(parseOrderDeltaCommentOrderId(legacy), 123);
assert.equal(parseOrderDeltaCommentOrderChip(legacy), "0123_О");
assert.equal(
  formatCalcDisplayComment(legacy),
  "Остаток; Иван; Ленина 1; сумма 5000",
  "старый номер заказа не должен оставаться в комментарии",
);

const current = "[AUTO_ORDER_DELTA] Остаток; офл.0123_О; Иван; Ленина 1; сумма 5000; 12:30; Алексей";
assert.equal(parseOrderDeltaCommentOrderId(current), null);
assert.equal(
  formatCalcDisplayComment(current),
  "Остаток; Иван; Ленина 1; сумма 5000",
);

assert.match(calculations, /buildOrderEditUrl\(orderId\)/);
assert.match(calculations, /class="td-calc-order"/);
assert.match(calculations, /comment, order_id, deleted_at/);
assert.match(calculations, /select\("id, address, order_type"\)/);
assert.match(orders, /comment: .*kindLabel.*orderNumberStr.*clientStr.*addressStr/);
assert.match(orders, /order_id: r\.order_id/);
assert.match(offline, /order_id: p\.order_id \?\? null/);
assert.match(migration, /ADD COLUMN IF NOT EXISTS order_id bigint/i);
assert.match(migration, /FOREIGN KEY \(order_id\)/i);
assert.match(migration, /comment, order_id/i);

console.log("calculations order column tests: ok");
