import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripAuthorFromManualComment } from '../js/calculations-format.js';
const source = fs.readFileSync(new URL('../js/calculations.js', import.meta.url), 'utf8');
const before = { id: 42, from_place: 'Дима', to_place: 'Зарплата', amount: 20000, comment: 'з/п Сергей и Стас, Аванс; Алексей' };
const after = { ...before, from_place: 'Вова', amount: 25000, comment: 'з/п Сергей и Стас, Доплата; Дима' };
let currentResult, updateResult, historyError, historyThrows, written, updates;
const context = vm.createContext({
  console: { error() {} },
  state: { currentUser: { email: 'golubintsev26@gmail.com' } }, currentUserEmail: 'golubintsev26@gmail.com',
  formatAmount: String, stripAuthorFromManualComment,
  ensureCurrentUserEmail() {}, validateCalculation: () => '',
  canEditManualCalculations: () => true,
  isSystemDeltaCalculationComment: comment => comment?.startsWith('[AUTO_ORDER_DELTA]'),
  supabaseClient: { from(table) {
    if (table === 'calculation_history') return { insert: async rows => {
      written.push(...rows);
      if (historyThrows) throw new Error('network');
      return { error: historyError };
    } };
    assert.equal(table, 'calculations');
    let updating = false;
    return {
      select() { return this; }, eq(key, id) { assert.equal(id, 42); return this; }, is() { return this; },
      update(payload) { updates.push(payload); updating = true; return this; },
      maybeSingle: async function () { return updating ? updateResult : currentResult; },
    };
  } },
});
for (const name of ['formatCalcHistoryAmount', 'formatCalcHistoryPlace', 'buildCalculationHistoryComments', 'insertCalculationHistoryComments', 'saveCalculationEdit']) {
  const fn = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`))[0];
  vm.runInContext(fn, context);
}
const comments = Array.from(context.buildCalculationHistoryComments(before, after, 'update'));
assert.deepEqual(comments, ['Расчёт изменён', 'Откуда: Дима → Вова', 'Сумма: 20000 → 25000', 'Комментарий: з/п Сергей и Стас, Аванс → з/п Сергей и Стас, Доплата']);
assert.deepEqual(Array.from(context.buildCalculationHistoryComments(before, { ...before, amount: '20000', comment: 'з/п Сергей и Стас, Аванс; Дима' }, 'update')), []);
assert.ok(context.buildCalculationHistoryComments(before, { ...before, to_place: 'Покупка' }, 'update').includes('Куда: Зарплата → Покупка'));
assert.ok(context.buildCalculationHistoryComments(before, { ...before, comment: '' }, 'update').includes('Комментарий: з/п Сергей и Стас, Аванс → —'));
assert.equal(context.buildCalculationHistoryComments(before, null, 'delete')[0], 'Расчёт удалён');
function reset() {
  currentResult = { data: before, error: null };
  updateResult = { data: after, error: null };
  historyError = null; historyThrows = false;
  written = []; updates = [];
}
const submit = () => context.saveCalculationEdit(before, { ...after });
reset();
const saved = await submit();
assert.equal(updates.length, 1);
assert.equal(written.length, comments.length);
assert.deepEqual(written.map(row => row.comment), comments);
assert.ok(written.every(row => row.calculation_id === 42 && row.user_email === 'golubintsev26@gmail.com'));
assert.equal(saved.updatedRow, after);
assert.equal(saved.historyOk, true);
for (const result of [{ data: null, error: { message: 'denied' } }, { data: null, error: null }]) {
  reset(); updateResult = result;
  const failed = await submit();
  assert.equal(written.length, 0);
  assert.equal(failed.updatedRow, undefined);
  assert.match(failed.message, /Ошибка при сохранении/);
}
reset(); currentResult = { data: { ...before, comment: '[AUTO_ORDER_DELTA] Монтаж' } };
await submit(); assert.equal(updates.length, 0); assert.equal(written.length, 0);
reset(); updateResult = { data: before, error: null };
await submit(); assert.equal(written.length, 0);
for (const networkFailure of [false, true]) {
  reset(); historyThrows = networkFailure; historyError = { message: 'history denied' };
  const partial = await submit();
  assert.equal(updates.length, 1);
  assert.equal(partial.updatedRow, after);
  assert.equal(partial.historyOk, false);
  assert.match(partial.message, /Запись обновлена, но/);
}
console.log('calculation edit history: field diffs, author, success, failed/zero-row update, system row, no-op and history errors passed');
