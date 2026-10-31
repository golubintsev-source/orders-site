import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
class Element {
  children = []; value = ''; dataset = {}; classList = { toggle() {}, remove() {} };
  appendChild(el) { this.children.push(el); }
  set innerHTML(v) { this.children = []; }
  setAttribute() {}
  querySelectorAll() { return this.children.map(row => row.children[0]); }
  querySelector() { return this.children[0]; }
  focus() {}
}
const elements = Object.fromEntries(['settingsOtherWorkersList', 'settingsEditorsList', 'settingsSaveOtherWorkersBtn'].map(id => [id, new Element()]));
const state = { balanceAdjustments: {}, editors: [] };
let admin = true, rows = [], error = null, writes = [];
const context = vm.createContext({
  state, isAdmin: () => admin, canManageWorkerSettings: () => admin, HTMLInputElement: Element, queueMicrotask,
  document: { getElementById: id => elements[id], createElement: () => new Element(), dispatchEvent() {} },
  CustomEvent: class {}, console,
  isOfflineWorkModeEnabled: () => false, persistSettingsSnapshotFromRows() {},
  supabaseClient: { from: table => { assert.equal(table, 'app_settings'); return {
    select: () => ({ in: async (_, keys) => { assert.ok(keys.includes('other_workers')); return { data: rows }; } }),
    upsert: async (row, options) => { writes.push(row); assert.equal(options.onConflict, 'key'); return { error }; },
  }; } },
});
const source = fs.readFileSync(new URL('../js/settings.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, '');
vm.runInContext(source, context);
await vm.runInContext('loadSettings()', context);
assert.equal(state.otherWorkers.length, 13);
assert.equal(state.otherWorkers[0], 'Иван Сотников');
assert.equal(state.otherWorkers[12], 'Кристина Шелякина');
assert.equal(elements.settingsSaveOtherWorkersBtn.disabled, true);
vm.runInContext('addOtherWorkerField()', context);
const list = elements.settingsOtherWorkersList;
list.children.at(-1).children[0].value = '  Новый   работник  ';
vm.runInContext('updateOtherWorkersSaveButtonState()', context);
assert.equal(elements.settingsSaveOtherWorkersBtn.disabled, false);
assert.equal(await vm.runInContext('saveOtherWorkers()', context), true);
assert.equal(JSON.parse(writes.at(-1).value).at(-1), 'Новый работник');
assert.equal(state.editors.length, 0);
assert.equal(elements.settingsSaveOtherWorkersBtn.disabled, true);
error = { message: 'failure' };
list.children[0].children[0].value = 'Не сохранён';
assert.equal(await vm.runInContext('saveOtherWorkers()', context), false);
assert.equal(state.otherWorkers[0], 'Иван Сотников');
admin = false;
const previousWrites = writes.length;
assert.equal(await vm.runInContext('saveOtherWorkers()', context), false);
assert.equal(writes.length, previousWrites);
rows = [{ key: 'other_workers', value: '[]' }];
await vm.runInContext('loadSettings()', context);
assert.equal(state.otherWorkers.length, 0, 'Saved empty list must not restore defaults');
rows = [{ key: 'other_workers', value: '["Сохранённый работник"]' }];
await vm.runInContext('loadSettings()', context);
assert.equal(state.otherWorkers[0], 'Сохранённый работник');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.ok(html.indexOf('>Монтажники</h3>') < html.indexOf('>Другие работники</h3>'));
assert.ok(html.indexOf('>Другие работники</h3>') < html.indexOf('>Корректировки</h3>'));
console.log('Other workers: defaults, add/edit/save, isolation, errors, admin guard, reload and empty list passed.');
