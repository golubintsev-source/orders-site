import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { orderSearchMatchesValues } from "../js/order-search-utils.js";

const visibleValues = [
  "1419_О",
  "25 сен",
  "Алексей",
  "нет",
  "Алжирская 10",
  "Балкон",
  "Производство",
  "100\u00a0000",
  "50\u00a0000",
  "Безнал",
  "+7 (999) 123-45-67",
];

assert.equal(orderSearchMatchesValues(visibleValues, "1419"), true);
assert.equal(orderSearchMatchesValues(visibleValues, "1419_о"), true);
assert.equal(orderSearchMatchesValues(visibleValues, "1419о"), true);
assert.equal(orderSearchMatchesValues(visibleValues, "алексей"), true);
assert.equal(orderSearchMatchesValues(visibleValues, "25 СЕН"), true);
assert.equal(orderSearchMatchesValues(visibleValues, "100000"), true);
assert.equal(orderSearchMatchesValues(visibleValues, "9991234567"), true);
assert.equal(orderSearchMatchesValues(visibleValues, "касса"), false);

const ordersSource = await readFile(new URL("../js/orders.js", import.meta.url), "utf8");
const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const swSource = await readFile(new URL("../sw.js", import.meta.url), "utf8");

assert.match(ordersSource, /\.\.\.getOrderRowValuesForExcel\(order\)/);
assert.match(ordersSource, /orderSearchMatchesValues\(/);
assert.match(ordersSource, /order\.order_number/);
assert.match(indexSource, /placeholder="Поиск по всем полям заказа…"/);
assert.match(swSource, /orders-site-static-v66/);

console.log("orders search tests: ok");
