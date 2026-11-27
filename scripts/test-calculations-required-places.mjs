import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const calculations = await readFile(new URL("js/calculations.js", root), "utf8");

for (const file of ["index.html", "calculations.html"]) {
  const html = await readFile(new URL(file, root), "utf8");
  assert.match(html, /<select id="calcFrom" required>/, `${file}: «Откуда» обязательно`);
  assert.match(html, /<select id="calcTo" required>/, `${file}: «Куда» обязательно`);
}

assert.match(calculations, /if \(!payload\.from_place\) return "Укажите, откуда"/);
assert.match(calculations, /if \(!payload\.to_place\) return "Укажите, куда"/);
assert.match(calculations, /<select id="calcEditFrom" required>/);
assert.match(calculations, /<select id="calcEditTo" required>/);

console.log("calculations required places tests: ok");
