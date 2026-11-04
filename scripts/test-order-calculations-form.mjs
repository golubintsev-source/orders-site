import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("index.html", root), "utf8");
const moduleSource = await readFile(new URL("js/order-calculations.js", root), "utf8");
const ordersSource = await readFile(new URL("js/orders.js", root), "utf8");
const styles = await readFile(new URL("style.css", root), "utf8");

const blockStart = html.indexOf('id="orderCalculationsBlock"');
const filesStart = html.indexOf('class="field full file-upload-group"');
assert.ok(blockStart > 0 && blockStart < filesStart, "блок расчётов должен находиться выше фото и документов");

const installerBlock = html.match(/id="installer_payment_block"[\s\S]*?<\/div>\s*<\/div>/)?.[0] || "";
assert.doesNotMatch(installerBlock, />Монтажник</);
assert.doesNotMatch(installerBlock, />Оплатил</);
assert.match(html, /<input type="hidden" id="installer_name"/);
assert.match(html, /<input type="hidden" id="installer_payment_by"/);
assert.match(html, /<option value="Монтаж" selected>Монтаж<\/option>/);
const orderTableHead = html.match(/<table id="orderCalculationsTable">[\s\S]*?<\/thead>/)?.[0] || "";
assert.doesNotMatch(orderTableHead, /<th>Заказ<\/th>/);
assert.doesNotMatch(moduleSource, /buildOrderEditUrl/);
assert.match(moduleSource, /colspan="7"/);
assert.match(html, /order-calculation-fields--first[\s\S]*?orderCalcFrom[\s\S]*?orderCalcTo[\s\S]*?order-calculation-fields--second/);
assert.match(html, /order-calculation-fields--second[\s\S]*?orderCalcRecipient[\s\S]*?orderCalcAmount[\s\S]*?calculations-form-row--comment-submit/);

assert.match(moduleSource, /destination === "Монтаж" \|\| destination === "Откосы"/);
assert.match(moduleSource, /const names = needsRecipient \? getEditors\(\) : \[\]/);
assert.match(moduleSource, /select\.disabled = !needsRecipient/);
assert.match(moduleSource, /bindAutogrowTextarea\(document\.getElementById\("orderCalcComment"\)\)/);
assert.match(moduleSource, /document\.getElementById\("orderCalcSubmitBtn"\).*addEventListener\("click"/s);
assert.match(moduleSource, /syncAmountFromInstallerPayment/);
assert.match(moduleSource, /installer-payment-amount-updated/);
assert.match(ordersSource, /new CustomEvent\("installer-payment-amount-updated"\)/);
assert.match(styles, /#section-new \.order-calculations-block \.calculations-comment-input\s*\{[\s\S]*?min-height: var\(--calc-submit-row-height, 40px\)/);
assert.match(styles, /\.order-calculations-block \.calculations-form-row--comment-submit \.calculations-comment-wrap\s*\{[\s\S]*?flex: 1 1 auto/);

console.log("order calculations form: placement, fields, recipients, defaults and autogrow passed");
