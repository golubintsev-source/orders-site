import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../js/calculations.js', import.meta.url), 'utf8');
const fields = {
  from: { replaceChildren(...options) { this.options = options; } },
  to: { replaceChildren(...options) { this.options = options; } },
};
const context = vm.createContext({
  Option: class { constructor(text, value) { Object.assign(this, { text, value }); } },
  CALC_FROM_OPTIONS: new Set(['Дима', 'Касса']),
  CALC_TO_OPTIONS: new Set(['Покупка', 'Касса']),
  KASSA_BEZNAL_PLACES: new Set(['Касса', 'Безнал']),
  canSelectKassaBeznal: () => true,
});
for (const name of ['syncCalcFromToOptions', 'configureCalcPlaces', 'validateCalculation', 'isForbiddenCalcKassaBeznal']) {
  const fn = source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0];
  vm.runInContext(fn, context);
}
const hasSalary = () => fields.to.options.some(option => option.value === 'Зарплата');
const salary = { to_place: 'Зарплата', amount: 100 };
for (const row of [undefined, { to_place: 'Покупка' }, salary]) {
  const allowed = row === salary;
  context.configureCalcPlaces(fields, row);
  assert.equal(hasSalary(), allowed);
  assert.equal(Boolean(context.validateCalculation(salary, row)), !allowed);
  assert.equal(context.validateCalculation({ ...salary, to_place: 'Покупка' }, row), '');
}
fields.to.value = 'Покупка';
context.syncCalcFromToOptions(fields);
assert.ok(hasSalary());
context.configureCalcPlaces(fields, { to_place: 'Павел' });
assert.equal(fields.to.value, 'Павел');
assert.ok(fields.to.options.some(option => option.value === 'Павел'));
assert.equal(hasSalary(), false);
context.configureCalcPlaces(fields);
assert.equal(fields.to.value, '');
assert.ok(fields.to.options.every(option => option.value !== 'Павел'));

context.canSelectKassaBeznal = () => false;
context.configureCalcPlaces(fields, { from_place: 'Касса' });
assert.equal(fields.from.value, 'Касса');
assert.ok(fields.to.options.every(option => option.value !== 'Касса'));
assert.equal(context.validateCalculation({ amount: 100, from_place: 'Касса' }, { from_place: 'Касса' }), '');
assert.match(context.validateCalculation({ amount: 100, to_place: 'Касса' }), /доступны только/);
for (const file of ['../index.html', '../calculations.html']) {
  const html = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.doesNotMatch(html.match(/<select id="calcTo">([^]*?)<\/select>/)[1], /value="Зарплата"/);
}
console.log('salary destination: new, editing, changing selection, reset, legacy destination and submit guard passed');
