import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("index.html", root), "utf8");
const moduleSource = await readFile(new URL("js/order-calculations.js", root), "utf8");

const blockStart = html.indexOf('id="orderCalculationsBlock"');
const filesStart = html.indexOf('class="field full file-upload-group"');
assert.ok(blockStart > 0 && blockStart < filesStart, "блок расчётов должен находиться выше фото и документов");

const installerBlock = html.match(/id="installer_payment_block"[\s\S]*?<\/div>\s*<\/div>/)?.[0] || "";
assert.doesNotMatch(installerBlock, />Монтажник</);
assert.doesNotMatch(installerBlock, />Оплатил</);
assert.match(html, /<input type="hidden" id="installer_name"/);
assert.match(html, /<input type="hidden" id="installer_payment_by"/);
assert.match(html, /<option value="Монтаж" selected>Монтаж<\/option>/);

assert.match(moduleSource, /destination === "Монтаж" \|\| destination === "Откосы"/);
assert.match(moduleSource, /const names = needsRecipient \? getEditors\(\) : \[\]/);
assert.match(moduleSource, /select\.disabled = !needsRecipient/);
assert.match(moduleSource, /bindAutogrowTextarea\(document\.getElementById\("orderCalcComment"\)\)/);
assert.match(moduleSource, /document\.getElementById\("orderCalcSubmitBtn"\).*addEventListener\("click"/s);

console.log("order calculations form: placement, fields, recipients, defaults and autogrow passed");
