import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../js/calculations.js', import.meta.url), 'utf8');
class Select {
  options = [];
  selected = '';
  get innerHTML() { return this.options.map(option => `<option value="${option.value}"></option>`).join(''); }
  set innerHTML(html) {
    this.options = [];
    for (const match of html.matchAll(/value="([^"]*)"/g)) this.appendChild({ value: match[1] });
    this.selected = this.options[0]?.value || '';
  }
  appendChild(option) {
    option.remove = () => { this.options = this.options.filter(item => item !== option); };
    this.options.push(option);
  }
  get value() { return this.options.some(option => option.value === this.selected) ? this.selected : ''; }
  set value(value) { this.selected = value; }
}
const from = new Select();
const to = new Select();
from.innerHTML = '<option value=""></option><option value="Дима"></option><option value="Касса"></option>';
// Include a stale salary option to verify it cannot leak from the backup.
to.innerHTML = '<option value=""></option><option value="Покупка"></option><option value="Касса"></option><option value="Зарплата"></option>';
const context = vm.createContext({
  document: { getElementById: id => id === 'calcFrom' ? from : to, createElement: () => ({}) },
  calcPlaceSelectHtmlBackup: new Map(), CALC_PLACE_SELECT_IDS: ['calcFrom', 'calcTo'],
  KASSA_BEZNAL_PLACES: new Set(['Касса', 'Безнал']), canSelectKassaBeznal: () => true,
  editingId: null, editingInitialTo: '',
});
for (const name of ['applyCalcPlaceSelectsForRole', 'isForbiddenCalcSalaryDestination']) {
  const fn = source.match(new RegExp(`(?:export )?function ${name}\\([^]*?\\n\\}`))[0].replace('export ', '');
  vm.runInContext(fn, context);
}
const hasSalary = () => to.options.some(option => option.value === 'Зарплата');
for (const [id, initial, allowed] of [[null, '', false], [1, 'Покупка', false], [2, 'Зарплата', true]]) {
  context.editingId = id;
  context.editingInitialTo = initial;
  context.applyCalcPlaceSelectsForRole();
  assert.equal(hasSalary(), allowed);
  assert.equal(context.isForbiddenCalcSalaryDestination('Зарплата'), !allowed);
  assert.equal(context.isForbiddenCalcSalaryDestination('Покупка'), false);
}
// Changing the selection must not remove salary while editing an original salary row.
to.value = 'Покупка';
context.applyCalcPlaceSelectsForRole();
assert.ok(hasSalary());
to.value = 'Зарплата';
context.applyCalcPlaceSelectsForRole();
assert.equal(to.value, 'Зарплата');
// A reset/new record must remove the previously available option.
context.editingId = null;
context.editingInitialTo = '';
context.applyCalcPlaceSelectsForRole();
assert.equal(hasSalary(), false);
assert.equal(to.value, '');
// Preserve the existing legacy employee destination behavior.
context.editingId = 3;
context.editingInitialTo = 'Павел';
to.appendChild({ value: 'Павел' });
to.value = 'Павел';
context.applyCalcPlaceSelectsForRole();
assert.equal(to.value, 'Павел');
assert.equal(hasSalary(), false);
assert.match(source, /isForbiddenCalcSalaryDestination\(payload.to_place\)/);
for (const file of ['../index.html', '../calculations.html']) {
  const html = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.doesNotMatch(html.match(/<select id="calcTo">([^]*?)<\/select>/)[1], /value="Зарплата"/);
}
console.log('salary destination: new, editing, changing selection, reset, legacy destination and submit guard passed');
