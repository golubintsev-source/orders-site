import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DEFAULT_ORDERS_ADDRESS_COLUMN_WIDTH,
  normalizeOrdersAddressColumnWidth,
  resolveOrdersAddressColumnWidth,
} from "../js/orders-address-column-width-utils.js";

assert.equal(normalizeOrdersAddressColumnWidth("80"), 80);
assert.equal(normalizeOrdersAddressColumnWidth("245.4"), 245);
assert.equal(normalizeOrdersAddressColumnWidth("600"), 600);
assert.equal(normalizeOrdersAddressColumnWidth("79"), null);
assert.equal(normalizeOrdersAddressColumnWidth("601"), null);
assert.equal(normalizeOrdersAddressColumnWidth("abc"), null);
assert.equal(resolveOrdersAddressColumnWidth("180", "240"), 180);
assert.equal(resolveOrdersAddressColumnWidth(null, "240"), 240);
assert.equal(resolveOrdersAddressColumnWidth(null, null), DEFAULT_ORDERS_ADDRESS_COLUMN_WIDTH);

const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const moduleSource = await readFile(new URL("../js/orders-address-column-width.js", import.meta.url), "utf8");
const mainSource = await readFile(new URL("../js/main.js", import.meta.url), "utf8");
const stickySource = await readFile(new URL("../js/ordersTableStickyHeader.js", import.meta.url), "utf8");
const styleSource = await readFile(new URL("../style.css", import.meta.url), "utf8");
const swSource = await readFile(new URL("../sw.js", import.meta.url), "utf8");

assert.match(indexSource, /id="ordersAddressWidthBtn"/);
assert.match(indexSource, /id="ordersAddressWidthModal"/);
assert.match(indexSource, /class="orders-col-address"/);
assert.match(moduleSource, /orders_site_address_column_width_v1:/);
assert.match(moduleSource, /orders_address_column_width_px/);
assert.match(moduleSource, /supabaseClient\.auth\.updateUser/);
assert.match(mainSource, /initOrdersAddressColumnWidth\(user\)/);
assert.match(stickySource, /\.address-column-width-btn/);
assert.match(styleSource, /--orders-address-column-width/);
assert.match(swSource, /orders-site-static-v65/);

console.log("orders address width tests: ok");
