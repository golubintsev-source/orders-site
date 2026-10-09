import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const calculations = await readFile(new URL("js/calculations.js", root), "utf8");
const style = await readFile(new URL("style.css", root), "utf8");

for (const file of ["index.html", "calculations.html"]) {
  const html = await readFile(new URL(file, root), "utf8");
  assert.doesNotMatch(html, /id="calcDateFrom"|id="calcAmountFrom"|id="calcSearchInput"/);
  for (const type of ["time", "author", "from", "to", "income", "expense", "comment"]) {
    assert.match(html, new RegExp(`data-calc-filter="${type}"`));
  }
  const order = ["time", "income", "expense", "comment", "from", "to", "author"];
  const positions = order.map((type) => html.indexOf(`data-calc-filter="${type}"`));
  assert.ok(positions.every((position) => position >= 0), `${file}: все заголовки найдены`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, `${file}: порядок столбцов`);
  assert.match(html, /calc-filter-heading-value/);
  assert.match(html, /calculations-export-row[\s\S]*id="calcExportExcelBtn"/);
}

assert.match(calculations, /const calcColumnFilters =/);
assert.match(calculations, /function normalizeCalcFilterText/);
assert.match(calculations, /replace\(\/\[\\p\{P\}\\p\{S\}\\s\]\+\/gu, ""\)/);
assert.match(calculations, /type="datetime-local"/);
assert.match(calculations, /calc-column-filter-find">Найти/);
assert.match(calculations, /calc-column-filter-reset">Сбросить/);
assert.match(calculations, /function updateCalcFilterHeadingStates/);
assert.match(style, /\.calc-filter-heading-btn\.is-filtered[\s\S]*font-weight:\s*800/);
assert.match(style, /\.calc-filter-heading-btn\.is-filtered \.calc-filter-heading-value[\s\S]*visibility:\s*visible/);
assert.match(style, /\.calc-filter-heading-btn > span::after/);
assert.doesNotMatch(style, /\.calc-filter-heading-btn[\s\S]{0,800}text-decoration:\s*underline/);
assert.match(style, /data-calc-filter="time"[\s\S]*width:\s*auto/);
assert.match(style, /\.calc-filter-heading-btn[\s\S]*min-width:\s*0/);
assert.match(style, /th:nth-child\(1\),[\s\S]*td:nth-child\(1\)[\s\S]*padding-right:\s*5px/);
assert.match(style, /th:nth-child\(7\),[\s\S]*td:nth-child\(7\)[\s\S]*padding-right:\s*5px/);
assert.match(
  calculations,
  /formatCalcTimeRu\(row\.created_at\)[\s\S]*\$\{incomeCell\}[\s\S]*\$\{expenseCell\}[\s\S]*td-calc-comment[\s\S]*row\.from_place[\s\S]*row\.to_place[\s\S]*td-calc-author/,
);

console.log("calculations column filters tests: ok");
