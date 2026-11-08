import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  formatCalcDisplayComment,
  formatInstallationCalculationDisplayComment,
  parseOrderDeltaCommentOrderChip,
  parseOrderDeltaCommentOrderId,
} from "../js/calculations-format.js";

const root = new URL("../", import.meta.url);
const calculations = await readFile(new URL("js/calculations.js", root), "utf8");
const orders = await readFile(new URL("js/orders.js", root), "utf8");
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
assert.equal(
  formatInstallationCalculationDisplayComment(
    "Монтаж; Иван; Ленина 1; оплатил Касса",
    "Сергей, Стас",
  ),
  "За монтаж Сергей, Стас; Иван; Ленина 1; оплатил Касса",
);
assert.equal(
  formatInstallationCalculationDisplayComment("Монтаж; Иван", ""),
  "За монтаж; Иван",
);
assert.equal(
  formatCalcDisplayComment("з/п [Сергей, Стас], доплата; Алексей"),
  "з/п Сергей, Стас, доплата",
);

assert.match(calculations, /buildOrderEditUrl\(orderId\)/);
assert.match(calculations, /class="td-calc-order"/);
assert.match(calculations, /comment, order_id, deleted_at/);
assert.match(calculations, /select\("id, address, order_type, installer_name"\)/);
assert.match(calculations, /getCalcDisplayCommentForRow\(row\)/);
assert.match(orders, /comment: .*kindLabel.*orderNumberStr.*clientStr.*addressStr/);
assert.match(orders, /order_id: r\.order_id/);
assert.match(migration, /ADD COLUMN IF NOT EXISTS order_id bigint/i);
assert.match(migration, /FOREIGN KEY \(order_id\)/i);
assert.match(migration, /comment, order_id/i);

console.log("calculations order column tests: ok");
