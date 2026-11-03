import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { validOrderField } from '../js/order-cell-highlights.js';
import { renderTaskComposerHtml } from '../js/task-composer-markup.js';

class Element {
  constructor(tag = 'div') {
    this.tag = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.hidden = false;
    this.textContent = ''; this.style = {}; this.isConnected = true;
    const values = new Set();
    this.classList = { add: v => values.add(v), remove: v => values.delete(v), contains: v => values.has(v) };
  }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.textContent = ''; this.append(...nodes); this.textContent = nodes.map(node => node.textContent || '').join(''); }
  querySelectorAll() { return []; }
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
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  focus() {} select() {} setSelectionRange() {}
}

const table = new Element('table'); const row = new Element('tr'); const idCell = new Element('td');
idCell.dataset.orderId = '42'; idCell.textContent = '0042_О'; const cell = new Element('td');
cell.dataset.orderField = 'client'; cell.dataset.fulltext = 'Полный <текст> клиента\nвторая строка'; cell.innerText = 'Полный…';
row.append(idCell, cell); table.append(row); row.querySelector = () => idCell;
const body = new Element('body'); body.append(table);
const document = new Element('document');
document.body = body; document.createElement = tag => new Element(tag);
document.getElementById = id => id === 'ordersTable' ? table : null;
let opened = []; let existingTask = null; let edits = []; let lookupError = false; let errors = [];
let now = 0; let nextTimer = 0; const timers = new Map();
const window = new Element(); window.getSelection = () => ({ removeAllRanges() {} });
const context = vm.createContext({
  document, window, console, validOrderField, Date: { now: () => now }, hideFloatingCellTooltip() {},
  navigator: { clipboard: { async writeText() {} } },
  setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id),
});
const source = fs.readFileSync(new URL('../js/orders-cell-menu.js', import.meta.url), 'utf8');
vm.runInContext(source.replace(/^import .*;\n/gm, '').replace(/export /g, ''), context);
context.initOrdersCellMenu({
  openTask: async options => { opened.push(options); },
  findTask: async () => { if (lookupError) throw new Error('lookup failed'); return existingTask; },
  editTask: async id => { edits.push(id); },
  reportError: error => { errors.push(error.message); },
});
context.initOrdersCellMenu();
assert.equal(body.children.length, 1, 'initialization must be idempotent and must not create an action menu');

function emit(target, type, values = {}) {
  const event = { target: cell, pointerId: 1, pointerType: 'touch', clientX: 40, clientY: 120,
    preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...values };
  const results = (target.listeners[type] || []).map(fn => fn(event));
  return { event, done: Promise.all(results) };
}
function start(values) { emit(document, 'pointerdown', values); emit(table, 'pointerdown', values); }
async function hold() {
  now += 500;
  for (const [id, fn] of [...timers]) { timers.delete(id); fn(); }
  await new Promise(resolve => setImmediate(resolve));
}
function release() { emit(document, 'pointerup'); }

start(); release(); await hold();
assert.equal(opened.length, 0, 'short tap keeps existing behavior');
start(); emit(document, 'pointermove', { clientX: 70 }); await hold(); release();
assert.equal(opened.length, 0, 'scroll movement cancels hold');
start(); emit(document, 'pointercancel'); await hold();
assert.equal(opened.length, 0, 'cancelled touch does not open a task');
start(); emit(document, 'pointerdown', { pointerId: 2 }); await hold();
assert.equal(opened.length, 0, 'pinch cancels hold');
emit(document, 'pointerup', { pointerId: 2 }); release();

start(); await hold(); release();
assert.equal(opened.length, 1, 'hold opens task creation directly');
assert.equal(opened[0].body, cell.dataset.fulltext);
assert.equal(opened[0].sourceOrderLabel, '0042_О');
assert.equal(opened[0].sourceOrderId, 42);
assert.equal(opened[0].sourceOrderField, 'client');
const click = emit(table, 'click').event;
assert.ok(click.prevented && click.stopped, 'synthetic tap after hold must not reach existing order actions');

existingTask = { id: 123, is_completed: false };
start(); await hold(); release();
assert.deepEqual(edits, [123], 'existing task opens directly in the shared task dialog');
assert.equal(opened.length, 1, 'existing task must not create a duplicate');

existingTask = { id: 124, is_completed: true, highlight_order_field: false };
start(); await hold(); release();
assert.deepEqual(edits, [123, 124], 'completed task is also opened for viewing/editing');

existingTask = null;
idCell.dataset.orderId = '99'; idCell.textContent = '0099_О';
start(); await hold(); release();
assert.equal(opened[1].sourceOrderId, 99, 'task uses the touched row order');

lookupError = true;
start(); await hold(); release();
assert.match(errors.at(-1), /lookup failed/, 'lookup errors are reported');
lookupError = false;

idCell.dataset.orderId = '-1';
start(); await hold(); release();
assert.equal(opened.length, 2, 'unsynced order must not produce an unlinked task');

idCell.dataset.orderId = '42';
emit(table, 'contextmenu');
await new Promise(resolve => setImmediate(resolve));
assert.equal(opened.length, 3, 'native long-press contextmenu also opens the task directly');

const dialogSource = fs.readFileSync(new URL('../js/task-create-dialog.js', import.meta.url), 'utf8');
assert.match(dialogSource, /sourceOrderId = pendingSourceOrderId/);
assert.match(dialogSource, /orderId: sourceOrderId/);
console.log('orders cell hold: direct create/edit, movement cancellation, pinch guard, cell link, errors and synthetic-click suppression passed');

// Exercise the real standard dialog and its insertTask payload with isolated data services.
const ids = ['taskCreateComposerHost', 'taskCreateDialogHighlight', 'taskCreateDialogTitle', 'taskCreateDialogTaskLabel', 'taskCreateDialog', 'taskCreateDialogText', 'taskCreateDialogExecutors', 'taskCreateDialogExecutorsHint',
  'taskCreateDialogOrderFieldBlock', 'taskCreateDialogOrderFieldLabel', 'taskCreateDialogOrderFieldValue', 'taskCreateDialogOrderFieldHint',
  'taskCreateDialogError', 'taskCreateDialogSubmitBtn', 'taskCreateDialogCancelBtn', 'taskCreateDialogCloseBtn'];
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
let draftAttachments = [];
let failPrepare = false;
let failInsert = false;
const orderFieldSaves = [];
const photoAttachment = { type: 'photo', storagePath: 'test/photo.jpg' };
const dialogContext = vm.createContext({
  document: { body: dialogBody, getElementById: id => fields.get(id), createElement: tag => new Element(tag), createTextNode: value => Object.assign(new Element('#text'), { textContent: String(value) }) },
  console: { error() {} }, validOrderField, renderTaskComposerHtml,
  buildOrderEditUrl: id => `/new?edit_order_id=${id}`, buildOrderNumberText: id => String(id).padStart(4, '0'),
  getCurrentUserEmail: () => 'golubintsev26@gmail.com', displayNameByEmail: () => 'Дима',
  loadTaskOrderField: async () => ({ field: 'client', label: 'Клиент', value: 'Иван', inputType: 'text', editable: true }),
  saveTaskOrderField: async (orderId, field, value, initial) => {
    orderFieldSaves.push({ orderId, field, value, initial });
    return String(value) !== String(initial);
  },
  createTaskAttachmentComposer: options => {
    let busy = false;
    assert.equal(options.getElement('orderTaskTextInput'), fields.get('taskCreateDialogText'));
    return {
      init() {}, isBusy: () => busy, hasAttachments: () => draftAttachments.length > 0,
      setBusy(value) { busy = value; options.onBusyChange(value); },
      clear() { draftAttachments = []; },
      async prepare() { if (failPrepare) throw new Error('upload failed'); return draftAttachments; },
    };
  },
  ensureTaskExecutorsInList: async () => {}, getSelectedExecutorEmailsFrom: () => ['worker@example.com'],
  resetTaskExecutorsList() {}, insertTask: async payload => { taskPayload = payload; return { error: failInsert ? new Error("save failed") : null }; },
  taskModules: { loadAllTasks() {}, loadOrderTasks() {}, refreshMyTasksNavBadge() {}, refreshActiveTaskOrderRefs() {}, addActiveTaskOrderRef() {}, applyOrderTaskHighlightsInDom() {} },
});
vm.runInContext(dialogSource.replace(/^import[^]*?from "[^\"]+";\n/gm, '')
  .replace(/export /g, '')
  .replace(/import\("\.\/(?:tasks|order-task-links|message-task-links)\.js"\)/g, 'Promise.resolve(taskModules)'), dialogContext);
await dialogContext.openTaskCreateDialog(opened[1]);
assert.equal(fields.get('taskCreateDialogText').value, cell.dataset.fulltext);
assert.equal(fields.get('taskCreateDialogTitle').textContent, 'Создание задачи к заказу № 0099_О');
assert.equal(fields.get('taskCreateDialogTaskLabel').textContent, 'Задача от Дима');
assert.equal(fields.get('taskCreateDialog').open, true);
assert.equal(fields.get('taskCreateDialogHighlight').checked, true);
fields.get('taskCreateDialogText').value = 'Проверить заказ';
await dialogContext.submitTaskCreateDialog();
assert.equal(fields.get('taskCreateDialog').open, false, 'closing the modal releases the background');
assert.equal(taskPayload.orderId, 99);
assert.equal(taskPayload.sourceOrderField, "client");
assert.equal(taskPayload.highlightOrderField, true);
assert.equal(taskPayload.body, 'Проверить заказ');
assert.equal(taskPayload.executorEmails[0], 'worker@example.com');
assert.equal(Object.hasOwn(taskPayload, 'dueAt'), false);
await dialogContext.openTaskCreateDialog();
assert.equal(fields.get('taskCreateDialogText').value, '');
assert.equal(fields.get('taskCreateDialogHighlight').checked, false);
assert.equal(fields.get('taskCreateDialogTitle').textContent, 'Новая задача');
await dialogContext.openTaskCreateDialog(opened[1]);
fields.get('taskCreateDialogHighlight').checked = false;
await dialogContext.submitTaskCreateDialog();
assert.equal(taskPayload.highlightOrderField, false);
assert.equal(taskPayload.sourceOrderField, 'client');
console.log('standard task dialog: cell text and order title prefilled, editable text saved, order link preserved and ordinary dialog reset');

const markup = renderTaskComposerHtml('taskCreate-', 'taskCreateDialogText');
assert.ok(!markup.includes('<span>Прикрепить</span>'));
assert.ok(markup.includes('messages-composer-tool-icon'));
for (const id of ['taskCreateDialogText', 'taskCreate-taskAttachBtn', 'taskCreate-taskAttachCameraBtn', 'taskCreate-taskAttachGalleryBtn', 'taskCreate-taskPickOrderBtn', 'taskCreate-taskComposerSuggestions']) assert.ok(markup.includes(`id="${id}"`));
await dialogContext.openTaskCreateDialog(opened[1]);
fields.get('taskCreateDialogText').value = '';
draftAttachments = [photoAttachment]; failPrepare = true;
await dialogContext.submitTaskCreateDialog();
assert.equal(draftAttachments.length, 1, 'failed upload preserves attachment draft');
assert.equal(fields.get('taskCreateDialog').open, true);
assert.equal(fields.get('taskCreateDialogSubmitBtn').disabled, false);
failPrepare = false; failInsert = true;
fields.get('taskCreateDialogOrderFieldValue').value = 'Пётр';
await dialogContext.submitTaskCreateDialog();
assert.equal(draftAttachments.length, 1, 'failed database save preserves attachment draft');
assert.equal(fields.get('taskCreateDialog').open, true);
failInsert = false;
await dialogContext.submitTaskCreateDialog();
assert.equal(orderFieldSaves.at(-2).initial, 'Иван');
assert.equal(orderFieldSaves.at(-1).initial, 'Пётр', 'retry treats an already saved order field as current');
assert.equal(taskPayload.attachments[0], photoAttachment);
assert.equal(taskPayload.orderId, 99);
assert.equal(draftAttachments.length, 0, 'successful save resets attachment draft');
assert.equal(fields.get('taskCreateDialog').open, false);
console.log('create dialog attachments: dedicated controls, photo-only save, upload error preserves draft and retry resets after success');

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(html, /Выделить в таблице/);
assert.match(html, /task-order-field-attention/);
assert.match(html, /<em class="task-order-field-question">\(по этому полю вопрос\)<\/em>/);
const messagesSection = html.match(/<section id="section-messages"[^]*?<\/section>/)?.[0];
assert.ok(messagesSection);
assert.ok(!messagesSection.includes('id="taskCreateDialog"'), 'new HTML must not place the shared dialog inside Chats');
console.log('task dialog regression: hidden-section relocation, cached shell compatibility and modal close passed');

