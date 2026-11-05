import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("index.html", root), "utf8");
const moduleSource = await readFile(new URL("js/order-calculations.js", root), "utf8");
const ordersSource = await readFile(new URL("js/orders.js", root), "utf8");
const styles = await readFile(new URL("style.css", root), "utf8");

const orderFormStart = html.indexOf('<form id="orderForm">');
const orderFormEnd = html.indexOf("</form>", orderFormStart);
const bottomSaveStart = html.indexOf('id="submitBtn"', orderFormStart);
const blockStart = html.indexOf('id="orderCalculationsBlock"');
const filesStart = html.indexOf('class="field full file-upload-group"');
const orderFormMarkup = html.slice(orderFormStart, orderFormEnd);
assert.ok(filesStart > 0 && filesStart < orderFormEnd, "фото и документы должны оставаться внутри формы заказа");
assert.ok(bottomSaveStart > filesStart && bottomSaveStart < orderFormEnd, "нижняя кнопка сохранения должна завершать форму заказа");
assert.ok(blockStart > orderFormEnd && blockStart > bottomSaveStart, "блок расчётов должен находиться ниже кнопки сохранения и вне формы заказа");
assert.doesNotMatch(orderFormMarkup, /orderCalc(?:From|To|Recipient|Amount|Comment|SubmitBtn)/, "поля расчётов не должны участвовать в форме заказа");
assert.match(html, /id="orderCalculationsBlock" class="field full order-calculations-block is-inactive"[^>]*aria-disabled="true"/);

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
assert.match(moduleSource, /function setBlockActive\(active\)[\s\S]*?querySelectorAll\("input, select, textarea, button"\)/);
assert.match(moduleSource, /showOrderCalculations[\s\S]*?setBlockActive\(true\)/);
assert.match(moduleSource, /hideOrderCalculations[\s\S]*?setBlockActive\(false\)/);
assert.match(moduleSource, /hideOrderCalculations[\s\S]*?syncAmountFromInstallerPayment\(\)/);
assert.match(moduleSource, /syncAmountFromInstallerPayment/);
assert.match(moduleSource, /installer-payment-amount-updated/);
assert.match(ordersSource, /new CustomEvent\("installer-payment-amount-updated"\)/);
assert.match(styles, /#section-new \.order-calculations-block \.calculations-comment-input\s*\{[\s\S]*?min-height: var\(--calc-submit-row-height, 40px\)/);
assert.match(styles, /\.order-calculations-block \.calculations-form-row--comment-submit \.calculations-comment-wrap\s*\{[\s\S]*?flex: 1 1 auto/);
assert.match(styles, /\.order-calculations-block\.is-inactive\s*\{[\s\S]*?background: #e5e7eb/);

const commentBuilder = moduleSource
  .match(/export function buildOrderCalculationComment\([^]*?\n\}/)[0]
  .replace("export ", "");
const context = vm.createContext({});
vm.runInContext(commentBuilder, context);
assert.equal(context.buildOrderCalculationComment("Монтаж", "Иван, Пётр", "", "Алексей"), "з/п монтаж —Иван, Пётр—; Алексей");
assert.equal(context.buildOrderCalculationComment("Откосы", "Сергей", "Доплата", "Алексей"), "з/п откосы —Сергей—, Доплата; Алексей");
assert.equal(context.buildOrderCalculationComment("Комиссия", "Комиссия", "", "Алексей"), "Комиссия; Алексей");
assert.equal(context.buildOrderCalculationComment("Другое", "Другое", "Расход", "Алексей"), "Другое, Расход; Алексей");

console.log("order calculations form: independent placement, inactive state, fields, recipients, defaults and autogrow passed");
