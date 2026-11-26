import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const calculations = await readFile(new URL("js/calculations.js", root), "utf8");
const style = await readFile(new URL("style.css", root), "utf8");

assert.ok(style.length > 250_000, "общий CSS не должен быть обрезан при публикации");

for (const file of ["index.html", "calculations.html"]) {
  const html = await readFile(new URL(file, root), "utf8");
  assert.match(html, /<option value="Налоги">Налоги<\/option>/);
  assert.match(html, /id="calcTaxTypeWrap"[^>]*hidden/);
  assert.match(html, /<label for="calcTaxType">Тип налога<\/label>/);
  for (const type of ["НДФЛ", "Страховые взносы", "Травматизм", "НДС", "Налог на прибыль"]) {
    assert.match(html, new RegExp(`<option value="${type}">${type}</option>`));
  }
  assert.ok(html.indexOf('id="calcTaxTypeWrap"') < html.indexOf('id="calcComment"'));
}

assert.match(calculations, /fields\.to\.value === "Налоги"/);
assert.match(calculations, /return "Выберите тип налога"/);
assert.match(calculations, /`Налоги; \$\{taxType\}/);
assert.match(calculations, /parts\[0\] === "Налоги" \? 1 : 0/);
assert.match(calculations, /function calculationDbPayload/);
assert.match(calculations, /syncCalcTaxTypeField\(fields/);
assert.match(style, /\.calculations-tax-type-row\[hidden\][\s\S]*display:\s*none/);

console.log("calculations tax type tests: ok");
