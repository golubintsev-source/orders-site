import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
class Element {
  constructor(tag = 'div') {
    this.tag = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.hidden = false;
    this.textContent = ''; this.style = {}; this.isConnected = true; this.offsetWidth = 300; this.offsetHeight = 180;
    const values = new Set();
    this.classList = { add: v => values.add(v), remove: v => values.delete(v), contains: v => values.has(v) };
  }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  get parentElement() { return this.parent || null; }
  appendChild(node) { node.remove(); this.append(node); }
  setAttribute(key, value) { this[key] = value; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  closest(selector) {
    if (selector.startsWith('button,')) return ['button','a','input','textarea','select','label'].includes(this.tag) ? this : this.parent?.closest(selector) || null;
    if (selector === 'tbody td') return this.tag === 'td' ? this : this.parent?.closest(selector) || null;
    if (selector === 'tbody tr') return this.tag === 'tr' ? this : this.parent?.closest(selector) || null;
    return null;
  }
  matches(selector) { return selector === '.td-actions' && this.classList.contains('td-actions'); }
  getBoundingClientRect() { return { left: 40, top: 100, bottom: 140 }; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  focus() {} select() {} setSelectionRange() {}
}
const table = new Element('table'); const row = new Element('tr'); const idCell = new Element('td');
idCell.dataset.orderId = '42'; idCell.textContent = '0042_О'; const cell = new Element('td');
cell.dataset.fulltext = 'Полный <текст> клиента\nвторая строка'; cell.innerText = 'Полный…';
row.append(idCell, cell); table.append(row); row.querySelector = () => idCell;
const body = new Element('body'); body.append(table);
const document = new Element('document');
document.body = body; document.createElement = tag => new Element(tag);
document.getElementById = id => id === 'ordersTable' ? table : null;
let clipboard = ''; let failCopy = false; let opened = [];
let now = 0; let nextTimer = 0; const timers = new Map();
const window = new Element(); window.innerWidth = 390; window.innerHeight = 844;
window.getSelection = () => ({ removeAllRanges() {} });
const context = vm.createContext({
  document, window, console, Date: { now: () => now }, hideFloatingCellTooltip() {},
  navigator: { clipboard: { async writeText(text) { if (failCopy) throw new Error('denied'); clipboard = text; } } },
  setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id),
});
document.execCommand = () => false;
const source = fs.readFileSync(new URL('../js/orders-cell-menu.js', import.meta.url), 'utf8');
vm.runInContext(source.replace(/^import .*;\n/gm, '').replace(/export /g, ''), context);
context.initOrdersCellMenu({ openTask: async options => { opened.push(options); } });
context.initOrdersCellMenu();
assert.equal(body.children.length, 2, 'initialization must be idempotent');
const menu = body.children[1]; const [preview, actions, status] = menu.children; const [copy, task] = actions.children;
function emit(target, type, values = {}) {
  const event = { target: cell, pointerId: 1, pointerType: 'touch', clientX: 40, clientY: 120,
    preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...values };
  const results = (target.listeners[type] || []).map(fn => fn(event));
  return { event, done: Promise.all(results) };
}
function start(values) { emit(document, 'pointerdown', values); emit(table, 'pointerdown', values); }
function hold() { now += 500; for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } }
function release() { emit(document, 'pointerup'); }
start(); release(); hold(); assert.equal(menu.hidden, true, 'short tap keeps existing behavior');
start(); emit(document, 'pointermove', { clientX: 70 }); hold(); release(); assert.equal(menu.hidden, true, 'scroll movement cancels hold');
start(); emit(document, 'pointercancel'); hold(); assert.equal(menu.hidden, true);
start(); emit(document, 'pointerdown', { pointerId: 2 }); hold(); assert.equal(menu.hidden, true, 'pinch cancels hold');
emit(document, 'pointerup', { pointerId: 2 }); release();
start(); hold(); release();
assert.equal(menu.hidden, false); assert.equal(preview.textContent, cell.dataset.fulltext);
assert.ok(cell.classList.contains('order-cell-selected'));
const click = emit(table, 'click').event;
assert.ok(click.prevented && click.stopped, 'synthetic tap after hold must not reach existing order actions');
await emit(copy, 'click', { target: copy }).done;
assert.equal(clipboard, cell.dataset.fulltext); assert.equal(menu.hidden, true);
start(); hold(); release();
await emit(task, 'click', { target: task }).done;
assert.equal(opened[0].body, cell.dataset.fulltext);
assert.equal(opened[0].sourceOrderLabel, '0042_О');
assert.equal(opened.length, 1); assert.equal(opened[0].sourceOrderId, 42); assert.equal(menu.hidden, true);
idCell.dataset.orderId = '99'; idCell.textContent = '0099_О';
start(); hold(); release(); await emit(task, 'click', { target: task }).done;
assert.equal(opened[1].sourceOrderId, 99, 'task uses the touched row order, not a previously selected order');
start(); hold(); release(); emit(document, 'scroll', { target: table }); assert.equal(menu.hidden, true);
start(); hold(); release(); emit(document, 'orders-table-will-render'); assert.equal(menu.hidden, true);
start(); hold(); release(); emit(document, 'keydown', { key: 'Escape' }); assert.equal(menu.hidden, true);
start(); hold(); release(); failCopy = true; await emit(copy, 'click', { target: copy }).done;
assert.equal(menu.hidden, false); assert.match(status.textContent, /Не удалось скопировать/);
failCopy = false; await emit(copy, 'click', { target: copy }).done; assert.equal(menu.hidden, true);
idCell.dataset.orderId = '-1'; start(); hold(); release(); assert.equal(task.disabled, true, 'unsynced order must not silently produce an unlinked task');
const dialogSource = fs.readFileSync(new URL('../js/task-create-dialog.js', import.meta.url), 'utf8');
assert.match(dialogSource, /sourceOrderId = pendingSourceOrderId/);
assert.match(dialogSource, /orderId: sourceOrderId/);
console.log('orders cell menu: short tap, hold, scroll, cancel, pinch, full-text copy, selected cell, task order link, refresh, escape, clipboard errors and offline order passed');

// Exercise the real standard dialog and its insertTask payload with isolated data services.
const ids = ['taskCreateDialogTitle', 'taskCreateDialog', 'taskCreateDialogText', 'taskCreateDialogExecutors', 'taskCreateDialogExecutorsHint',
  'taskCreateDialogDueAt', 'taskCreateDialogError', 'taskCreateDialogSubmitBtn', 'taskCreateDialogCancelBtn', 'taskCreateDialogCloseBtn'];
const fields = new Map(ids.map(id => [id, new Element()]));
const dialogBody = new Element('body');
const hiddenMessagesSection = new Element('section');
hiddenMessagesSection.hidden = true;
dialogBody.append(hiddenMessagesSection);
hiddenMessagesSection.append(fields.get('taskCreateDialog'));
fields.get('taskCreateDialog').showModal = function () {
  assert.equal(this.parentElement, dialogBody, 'modal must escape the hidden chat section before opening');
  this.open = true;
};
fields.get('taskCreateDialog').close = function () { this.open = false; };
let taskPayload;
const dialogContext = vm.createContext({
  document: { body: dialogBody, getElementById: id => fields.get(id) }, console,
  defaultTaskDueAtLocal: () => '2026-11-02T09:00', datetimeLocalToIso: value => value,
  ensureTaskExecutorsInList: async () => {}, getSelectedExecutorEmailsFrom: () => ['worker@example.com'],
  resetTaskExecutorsList() {}, insertTask: async payload => { taskPayload = payload; return { error: null }; },
  taskModules: { loadAllTasks() {}, loadOrderTasks() {}, refreshMyTasksNavBadge() {}, addActiveTaskOrderRef() {}, applyOrderTaskHighlightsInDom() {} },
});
vm.runInContext(dialogSource.replace(/^import[^]*?from "[^\"]+";\n/, '')
  .replace(/export /g, '')
  .replace(/import\("\.\/(?:tasks|order-task-links|message-task-links)\.js"\)/g, 'Promise.resolve(taskModules)'), dialogContext);
await dialogContext.openTaskCreateDialog(opened[1]);
assert.equal(fields.get('taskCreateDialogText').value, cell.dataset.fulltext);
assert.equal(fields.get('taskCreateDialogTitle').textContent, 'Создание задачи к заказу № 0099_О');
assert.equal(fields.get('taskCreateDialog').open, true);
fields.get('taskCreateDialogText').value = 'Проверить заказ';
await dialogContext.submitTaskCreateDialog();
assert.equal(fields.get('taskCreateDialog').open, false, 'closing the modal releases the background');
assert.equal(taskPayload.orderId, 99);
assert.equal(taskPayload.body, 'Проверить заказ');
assert.equal(taskPayload.executorEmails[0], 'worker@example.com');
assert.equal(taskPayload.dueAt, '2026-11-02T09:00');
await dialogContext.openTaskCreateDialog();
assert.equal(fields.get('taskCreateDialogText').value, '');
assert.equal(fields.get('taskCreateDialogTitle').textContent, 'Новая задача');
console.log('standard task dialog: cell text and order title prefilled, editable text saved, order link preserved and ordinary dialog reset');

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const messagesSection = html.match(/<section id="section-messages"[^]*?<\/section>/)?.[0];
assert.ok(messagesSection);
assert.ok(!messagesSection.includes('id="taskCreateDialog"'), 'new HTML must not place the shared dialog inside Chats');
console.log('task dialog regression: hidden-section relocation, cached shell compatibility and modal close passed');
