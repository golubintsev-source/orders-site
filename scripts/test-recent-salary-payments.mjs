import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { groupSalaryRowsByMonth, groupSalaryRowsByEmployee, salaryCalculationAmount } from '../js/all-salaries-utils.js';
import { formatCalcDisplayComment } from '../js/calculations-format.js';
const source = fs.readFileSync(new URL('../js/all-salaries.js', import.meta.url), 'utf8');
const body = { innerHTML: '' };
const context = vm.createContext({
  document: { getElementById: () => body },
  groupSalaryRowsByEmployee, salaryCalculationAmount,
  getCalcDisplayComment: formatCalcDisplayComment, formatAmount: String, formatSalaryDate: String,
  escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
});
vm.runInContext(source.match(/function renderRecentSalaryPayments\([^]*?\n\}/)[0], context);
const payment = (id, created_at, month) => ({ id, created_at, from_place: 'Дима', to_place: 'Зарплата', amount: id * 100, comment: `з/п Павел, ${month}; Алексей` });
const groups = groupSalaryRowsByMonth([
  payment(1, '2026-11-01T10:00:00Z', 'ноябрь'),
  payment(2, '2026-11-02T10:00:00Z', 'сентябрь'),
  payment(3, '2026-11-03T10:00:00Z', 'октябрь'),
  payment(4, '2026-11-03T10:00:00Z', 'октябрь'),
]);
const original = JSON.stringify(groups);
context.renderRecentSalaryPayments(groups);
assert.equal((body.innerHTML.match(/<tr>/g) || []).length, 3);
assert.ok(body.innerHTML.indexOf('400&nbsp;') < body.innerHTML.indexOf('300&nbsp;'));
assert.ok(body.innerHTML.indexOf('300&nbsp;') < body.innerHTML.indexOf('200&nbsp;'));
assert.ok(!body.innerHTML.includes('100&nbsp;'));
assert.ok(body.innerHTML.includes('Павел'));
assert.equal(JSON.stringify(groups), original);
context.renderRecentSalaryPayments([{ rows: [{ ...payment(5, '2026-11-04', ''), comment: 'з/п Павел, <script>; Алексей' }] }]);
assert.ok(!body.innerHTML.includes('<script>'));
context.renderRecentSalaryPayments([]);
assert.match(body.innerHTML, /Выплат зарплаты пока нет/);
context.renderRecentSalaryPayments([], 'Загрузка…');
assert.match(body.innerHTML, /Загрузка…/);
console.log('recent salary payments: latest dates across salary months, ties, limit, recipients, escaping and empty/loading states passed');
