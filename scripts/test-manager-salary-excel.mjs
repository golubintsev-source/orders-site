import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const source = await readFile(new URL("../js/manager-salary.js", import.meta.url), "utf8");
const style = await readFile(new URL("../style.css", import.meta.url), "utf8");
const sw = await readFile(new URL("../sw.js", import.meta.url), "utf8");

assert.match(html, /id="managerSalaryExportExcelBtn"[\s\S]*Выгрузить в Excel/);
assert.match(source, /orders\.map\(\(order\) => getManagerSalaryRowValuesForExcel\(order\)\)/);
assert.match(source, /await ensureXlsx\(\)/);
assert.match(source, /downloadXlsxBuffer\(buffer, filename\)/);
assert.match(source, /exportBtn\.addEventListener\("click"/);
assert.match(source, /"Учитывать"[\s\S]*"Кому остаток"/);
assert.match(style, /\.manager-salary-export-row/);
assert.match(sw, /orders-site-static-v75/);

console.log("manager salary Excel tests: ok");
