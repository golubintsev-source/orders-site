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
assert(calcJs.includes("function rowMatchesAmountRange("), "в calculations.js есть rowMatchesAmountRange");
assert(calcJs.includes("appliedCalcAmountFrom"), "в calculations.js есть appliedCalcAmountFrom");
assert(calcJs.includes("calcAmountFrom"), "в calculations.js читается calcAmountFrom");
assert(calcJs.includes("calcAmountTo"), "в calculations.js читается calcAmountTo");

for (const file of ["index.html", "calculations.html"]) {
  const html = fs.readFileSync(path.join(root, file), "utf8");
  assert(html.includes('id="calcAmountFrom"'), `${file}: поле суммы «от»`);
  assert(html.includes('id="calcAmountTo"'), `${file}: поле суммы «до»`);
  assert(html.includes('calculations-form-row--amounts'), `${file}: строка диапазона сумм ниже дат`);
  assert(html.includes('class="calculations-amount-input"'), `${file}: класс полей суммы`);
  assert(/id="calcAmountFrom"[^>]*size="8"/.test(html), `${file}: компактный size у «от»`);
  assert(/id="calcAmountTo"[^>]*size="8"/.test(html), `${file}: компактный size у «до»`);
  const dateIdx = html.indexOf('calculations-form-row--dates');
  const amountIdx = html.indexOf('calculations-form-row--amounts');
  assert(dateIdx >= 0 && amountIdx > dateIdx, `${file}: поля сумм идут ниже полей дат`);
}

const css = fs.readFileSync(path.join(root, "style.css"), "utf8");
assert(
  /#calcAmountFrom[\s\S]*font-size:\s*16px/.test(css),
  "style.css: поля «от»/«до» с font-size 16px (без зума iOS)"
);
assert(
  /#calcAmountFrom[\s\S]*width:\s*6\.8rem/.test(css),
  "style.css: ширина полей сумм как у дат (6.8rem)"
);
assert(
  /#calcAmount\s*,[\s\S]*font-size:\s*16px/.test(css) || /#calcAmount \{[\s\S]*font-size:\s*16px/.test(css),
  "style.css: поле «Сумма» с font-size 16px"
);
assert(
  css.includes("calculations-form-row--amounts") && css.includes("flex-direction: row"),
  "style.css: «от» и «до» в одну строку"
);

console.log("test-calc-amount-range: ok");
