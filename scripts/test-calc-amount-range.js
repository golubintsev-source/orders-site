/**
 * Проверка фильтра диапазона сумм на странице расчётов.
 * Запуск: node scripts/test-calc-amount-range.js
 */
const fs = require("fs");
const path = require("path");

function rowMatchesAmountRange(row, fromAmount, toAmount) {
  if (fromAmount == null && toAmount == null) return true;
  const n = Number(row?.amount);
  if (!Number.isFinite(n)) return false;
  if (fromAmount != null && n < fromAmount) return false;
  if (toAmount != null && n > toAmount) return false;
  return true;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(rowMatchesAmountRange({ amount: 100 }, null, null), "без фильтра все строки видны");
assert(rowMatchesAmountRange({ amount: 100 }, 100, 100), "границы включительно");
assert(rowMatchesAmountRange({ amount: 150 }, 100, 200), "внутри диапазона");
assert(!rowMatchesAmountRange({ amount: 99 }, 100, 200), "ниже нижней границы");
assert(!rowMatchesAmountRange({ amount: 201 }, 100, 200), "выше верхней границы");
assert(rowMatchesAmountRange({ amount: 500 }, 100, null), "только нижняя граница");
assert(!rowMatchesAmountRange({ amount: 50 }, 100, null), "ниже только нижней границы");
assert(rowMatchesAmountRange({ amount: 50 }, null, 100), "только верхняя граница");
assert(!rowMatchesAmountRange({ amount: 150 }, null, 100), "выше только верхней границы");
assert(!rowMatchesAmountRange({ amount: null }, 1, 10), "пустая сумма не проходит заданный диапазон");
assert(!rowMatchesAmountRange({ amount: "" }, 1, 10), "пустая строка суммы не проходит диапазон");
assert(rowMatchesAmountRange({ amount: 0 }, 0, 10), "ноль входит в диапазон от 0");

const root = path.join(__dirname, "..");
const calcJs = fs.readFileSync(path.join(root, "js/calculations.js"), "utf8");
assert(calcJs.includes("incomeFrom"), "есть отдельная нижняя граница дохода");
assert(calcJs.includes("incomeTo"), "есть отдельная верхняя граница дохода");
assert(calcJs.includes("expenseFrom"), "есть отдельная нижняя граница расхода");
assert(calcJs.includes("expenseTo"), "есть отдельная верхняя граница расхода");
assert(calcJs.includes('id="calcFilterAmountFrom"'), "попап содержит сумму «от»");
assert(calcJs.includes('id="calcFilterAmountTo"'), "попап содержит сумму «до»");

for (const file of ["index.html", "calculations.html"]) {
  const html = fs.readFileSync(path.join(root, file), "utf8");
  assert(html.includes('data-calc-filter="income"'), `${file}: фильтр дохода в заголовке`);
  assert(html.includes('data-calc-filter="expense"'), `${file}: фильтр расхода в заголовке`);
  assert(!html.includes('id="calcAmountFrom"'), `${file}: старое поле суммы «от» убрано`);
  assert(!html.includes('calculations-form-row--amounts'), `${file}: старый блок сумм убран`);
}

const css = fs.readFileSync(path.join(root, "style.css"), "utf8");
assert(
  /\.calc-column-filter-field input[\s\S]*font-size:\s*16px/.test(css),
  "style.css: поля попапа с font-size 16px (без зума iOS)"
);
assert(
  /#calcAmount\s*,[\s\S]*font-size:\s*16px/.test(css) || /#calcAmount \{[\s\S]*font-size:\s*16px/.test(css),
  "style.css: поле «Сумма» с font-size 16px"
);
assert(css.includes("calc-column-filter-actions"), "style.css: действия попапа оформлены");

console.log("test-calc-amount-range: ok");
