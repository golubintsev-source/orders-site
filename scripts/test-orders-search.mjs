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
const historySource = await readFile(new URL("../history.html", import.meta.url), "utf8");
const uiSource = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
const stickyHeaderSource = await readFile(new URL("../js/ordersTableStickyHeader.js", import.meta.url), "utf8");
const styleSource = await readFile(new URL("../style.css", import.meta.url), "utf8");
const swSource = await readFile(new URL("../sw.js", import.meta.url), "utf8");

assert.match(ordersSource, /\.\.\.getOrderRowValuesForExcel\(order\)/);
assert.match(ordersSource, /orderSearchMatchesValues\(/);
assert.match(ordersSource, /order\.order_number/);
assert.match(indexSource, /placeholder="Поиск по всем полям заказа…"/);
const ordersSectionStart = indexSource.indexOf('id="section-all"');
const searchButton = indexSource.indexOf('id="ordersSearchOpenBtn"');
const clientHeader = indexSource.indexOf('class="th-orders-col-150 th-client-search-header"');
assert.ok(ordersSectionStart >= 0 && clientHeader > ordersSectionStart && searchButton > clientHeader);
assert.doesNotMatch(indexSource.slice(0, ordersSectionStart), /id="ordersSearchOpenBtn"/);
assert.doesNotMatch(indexSource, /ordersShortcutWrap|ordersShortcutBtn/);
assert.doesNotMatch(historySource, /id="ordersSearchOpenBtn"|ordersShortcutBtn/);
assert.ok(indexSource.indexOf('id="navigationBackBtn"') < indexSource.indexOf('id="sectionNavCurrentBtn"'));
assert.ok(historySource.indexOf('id="navigationBackBtn"') < historySource.indexOf('id="sectionNavCurrentBtn"'));
assert.match(indexSource, /id="ordersSearchOpenBtn"[\s\S]*?<span>Клиент<\/span>[\s\S]*?orders-client-search-icon/);
assert.match(uiSource, /ordersSearchOpenBtn\.classList\.add\("orders-client-search-btn--open"\)/);
assert.match(stickyHeaderSource, /closest\("\.orders-client-search-btn"\)[\s\S]*?__ordersSearchAnchorRect[\s\S]*?originalSearchBtn\.click\(\)/);
assert.match(styleSource, /\.orders-client-search-icon\s*\{[\s\S]*?width: 14px;[\s\S]*?height: 14px;/);
assert.match(styleSource, /#ordersTable th\.th-client-search-header[\s\S]*?padding: 0 2px;/);
assert.match(styleSource, /\.orders-search-dropdown-panel--table\s*\{[\s\S]*?position: fixed;/);
assert.match(swSource, /orders-site-static-v\d+/);

console.log("orders search tests: ok");
