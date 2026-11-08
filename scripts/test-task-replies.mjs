import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
let allowed = true, calls = [], resolveWrite;
let sizedFields = [], disposedFields = [];
const context = vm.createContext({
  bindAutogrowTextarea: field => { sizedFields.push(field); return () => disposedFields.push(field); },
  getCurrentUserEmail: () => 'worker@example.com', isUserExecutorOfTask: () => allowed,
  supabaseClient: { from: table => {
    assert.equal(table, 'order_tasks'); const call = { filters: [] };
    return {
      update(patch) { call.patch = patch; calls.push(call); return this; },
      eq(key, value) { call.filters.push([key, value]); return this; },
      contains(key, value) { call.contains = [key, value]; return this; }, is() { return this; }, select() { return this; },
      maybeSingle() { return new Promise(resolve => { resolveWrite = resolve; }); },
    };
  } },
});
vm.runInContext(fs.readFileSync(new URL('../js/task-replies.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, ''), context);
assert.equal(context.replyIsDirty('', ''), false);
assert.equal(context.replyIsDirty('New', ''), true);
const row = { id: 42, executor_reply: '', executor_emails: ['worker@example.com'] };
const root = { dataset: {}, listeners: {}, contains: () => true, querySelectorAll: selector => selector === ".task-reply-input" ? [root.editor.querySelector(selector)] : [root.editor],
  addEventListener(type, fn) { this.listeners[type] = fn; } };
function editorFromHtml(html, value = '') {
  const key = html.match(/data-reply-key="([^"]+)"/)[1];
  const input = { value, disabled: false, matches: () => true, closest: () => editor };
  const button = { disabled: /class="task-reply-save"[^>]*disabled/.test(html), closest: selector => selector === '.task-reply-save' ? button : editor };
  const message = { textContent: '', hidden: true };
  const editor = { dataset: { replyKey: key }, querySelector: selector => ({ '.task-reply-input': input, '.task-reply-save': button, '.task-reply-message': message })[selector] };
  return { editor, input, button, message };
}
let controls = editorFromHtml(context.renderTaskReplyCell(row)); root.editor = controls.editor;
context.bindTaskReplyControls(root);
controls.input.isConnected = true;
context.resizeTaskReplyFields(root);
context.resizeTaskReplyFields(root);
assert.equal(sizedFields.length, 1, 'one sizing listener per reply field');
assert.match(context.renderTaskReplyCell(row), /rows="1"/);
assert.equal(controls.button.disabled, true);
const input = text => { controls.input.value = text; root.listeners.input({ target: controls.input }); };
const click = () => root.listeners.click({ target: controls.button, preventDefault() {} });
input('Ответ'); assert.equal(controls.button.disabled, false);
input(''); assert.equal(controls.button.disabled, true);
input('Ответ');
const first = click(); assert.equal(controls.button.disabled, true); assert.equal(controls.input.disabled, true);
await click(); assert.equal(calls.length, 1, 'double submit must not send two writes');
assert.equal(calls[0].patch.executor_reply, 'Ответ');
assert.deepEqual(calls[0].filters, [['id', 42], ['executor_reply', '']]);
assert.equal(calls[0].contains[0], 'executor_emails'); assert.equal(calls[0].contains[1][0], 'worker@example.com');
resolveWrite({ data: { id: 42, executor_reply: 'Ответ' }, error: null }); await first;
assert.equal(controls.button.disabled, true); assert.equal(controls.input.disabled, false);
input('Правка'); const failed = click(); resolveWrite({ data: null, error: { message: 'network' } }); await failed;
assert.equal(controls.input.value, 'Правка'); assert.equal(controls.button.disabled, false); assert.equal(controls.message.hidden, false);
assert.ok(context.renderTaskReplyCell({ ...row, executor_reply: 'Ответ' }).includes('Правка'), 'reload preserves unsaved reply');
const retry = click(); resolveWrite({ data: null, error: null }); await retry;
assert.match(controls.message.textContent, /Ответ уже изменён/);
input(''); const cleared = click(); resolveWrite({ data: { id: 42, executor_reply: '' }, error: null }); await cleared;
assert.equal(controls.button.disabled, true, 'clearing saved reply can be saved');
allowed = false;
assert.equal((await context.saveExecutorReply(row, 'No', '')).ok, false);
assert.ok(!context.renderTaskReplyCell(row).includes('<textarea'));
allowed = true;
assert.ok(!context.renderTaskReplyCell({ ...row, id: 43, executor_reply: '</textarea><script>x</script>' }).includes('<script>'));
controls.input.isConnected = false;
root.editor = { querySelector: () => ({ isConnected: true }) };
context.resizeTaskReplyFields(root);
assert.equal(disposedFields.length, 1, 're-render removes sizing handlers for old fields');
console.log('task replies: grey/green dirty state, save, duplicate prevention, edit/clear, errors/conflict, draft preservation, executor guard and escaping passed');
// Exercise the real shared edit dialog used from task lists and order cells.
let modal = null, patchSent, updateFilters, role = 'author', conflict = false, savedRow;
const editorSizedFields = [];
let deleteResult = false, deletedId;
const node = () => ({ value: '', checked: false, disabled: false, readOnly: false, dataset: {}, hidden: false, listeners: {},
  textContent: '', addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }, focus() {}, append() {}, appendChild() {},
  replaceChildren(...children) { this.children = children; this.textContent = children.map(child => child.textContent || '').join(''); },
  querySelector() { return null; }, querySelectorAll() { return []; },
  async emit(type) { for (const fn of this.listeners[type] || []) await fn({ preventDefault() {} }); } });
let fields, form, editText, executors, submit, cancel, titleEl;
const document = {
  getElementById: id => id === 'taskEditDialog' ? modal : null,
  body: { append(dialog) { modal = dialog; dialog.isConnected = true; } },
  createTextNode: text => ({ textContent: text }),
  createElement(tag) {
    if (tag !== 'dialog') return node();
    fields = Object.fromEntries(['reply','reply-label','completed','highlight','hint','error','delete','task-label','order-field-block','order-field-label','order-field-value','order-field-text-value','order-field-hint'].map(key => [key, node()]));
    form = node(); editText = node(); executors = node(); submit = node(); cancel = node(); titleEl = node();
    form.querySelectorAll = () => [...Object.values(fields), editText, submit, cancel];
    const dialog = node(); dialog.setAttribute = () => {};
    dialog.querySelector = selector => {
      const field = selector.match(/^\[data-field="([^"]+)"\]$/)?.[1];
      if (field) return fields[field];
      return ({ form, '#taskEditExecutors': executors, '[type="submit"]': submit, '.task-create-dialog-cancel': cancel, '#taskEdit-orderTaskTextInput': editText, '#taskEditTitle': titleEl })[selector] || null;
    };
    dialog.showModal = () => { dialog.open = true; };
    dialog.remove = () => { modal = null; dialog.isConnected = false; };
    dialog.close = () => { dialog.open = false; for (const fn of dialog.listeners.close || []) fn(); };
    return dialog;
  },
};
const taskRow = {
  id: 50, author_login: 'author@example.com', body: 'Задача', executor_emails: ['worker@example.com'],
  executor_reply: 'Старый ответ', is_completed: false, order_id: 42, source_order_field: 'client', highlight_order_field: false, attachments: [],
};
let savedOrderField;
const editorContext = vm.createContext({
  deleteModule: { softDeleteAuthorTask: async id => { deletedId = id; return deleteResult; } },
  document, console,
  bindAutogrowTextarea: field => { editorSizedFields.push(field); return () => {}; },
  isUserAuthorOfTask: () => role === 'author' || role === 'both',
  isUserExecutorOfTask: () => role === 'executor' || role === 'both',
  getCurrentUserEmail: () => role === 'author' || role === 'both' ? 'author@example.com' : 'worker@example.com',
  getSelectedExecutorEmailsFrom: () => ['new@example.com'],
  normalizeExecutorEmails: value => value || [], isTaskExecutorVisible: () => true, visibleTaskExecutorEmails: value => value || [],
  ensureTaskExecutorsInList: async list => { list.dataset.loaded = '1'; }, renderTaskComposerHtml: () => '',
  createTaskAttachmentComposer: () => ({ init() {}, dispose() {}, hasAttachments: () => false }),
  buildOrderEditUrl: id => `/new?edit_order_id=${id}`, buildOrderNumberText: id => String(id).padStart(4, '0'),
  displayNameGenitiveByEmail: email => email === 'author@example.com' ? 'Автора' : email === 'worker@example.com' ? 'Исполнителя' : email,
  loadTaskOrderField: async () => ({ field: 'client', label: 'Клиент', value: 'Старый клиент', inputType: 'text', editable: true }),
  saveTaskOrderField: async (orderId, field, value, initial) => { savedOrderField = { orderId, field, value, initial }; return true; },
  supabaseClient: { from: () => {
    let updating = false; updateFilters = [];
    return {
      select() { return this; }, eq(key, value) { updateFilters.push([key, value]); return this; }, is() { return this; },
      contains(key, value) { updateFilters.push([key, value]); return this; },
      update(patch) { updating = true; patchSent = patch; return this; },
      maybeSingle: async () => ({ data: updating ? (conflict ? null : { id: 50 }) : taskRow, error: null }),
    };
  } },
});
const editSource = fs.readFileSync(new URL('../js/task-edit-dialog.js', import.meta.url), 'utf8');
vm.runInContext(editSource.replace(/^import[^]*?from "[^"]+";\n/gm, '').replace(/export /g, '').replace(/import\("\.\/tasks\.js"\)/g, 'Promise.resolve(deleteModule)'), editorContext);

role = 'author';
await editorContext.openTaskEditDialog(50, row => { savedRow = row; });
assert.equal(editText.readOnly, false);
assert.equal(fields.reply.readOnly, true, 'author cannot edit the executor reply');
assert.equal(fields.completed.disabled, false);
assert.equal(fields.highlight.disabled, false);
assert.equal(fields.delete.hidden, false);
assert.equal(submit.hidden, false);
assert.equal(fields['order-field-text-value'].disabled, false);
assert.equal(fields['order-field-text-value'].hidden, false);
assert.match(modal.innerHTML, /Редактировать задачу/);
assert.match(modal.innerHTML, /Выделить в таблице/);
assert.match(modal.innerHTML, /task-order-field-attention/);
assert.match(modal.innerHTML, /\(по этому полю вопрос\)/);
assert.match(modal.innerHTML, /Задача выполнена/);
assert.match(modal.innerHTML, /class="task-create-dialog-cancel">Закрыть<\/button>/);
assert.equal(fields['task-label'].textContent, 'Задача от Автора');
assert.equal(fields['reply-label'].textContent, 'Ответ от Исполнителя');
assert.equal(editText.rows, 1);
assert.ok(editorSizedFields.includes(fields.reply));
editText.value = 'Исправленная задача';
fields.completed.checked = true;
fields.highlight.checked = true;
fields.reply.value = 'Cannot change';
fields['order-field-text-value'].value = 'Новый клиент';
await form.emit('submit');
assert.equal(patchSent.body, 'Исправленная задача');
assert.equal(patchSent.is_completed, true);
assert.equal(patchSent.highlight_order_field, true);
assert.equal(Object.hasOwn(patchSent, 'executor_reply'), false);
assert.deepEqual(patchSent.executor_emails, ['new@example.com']);
assert.equal(savedRow.is_completed, true);
assert.match(titleEl.textContent, /Заказ № 0042/);
assert.equal(fields['order-field-label'].textContent, 'Клиент');
assert.deepEqual(savedOrderField, { orderId: 42, field: 'client', value: 'Новый клиент', initial: 'Старый клиент' });

role = 'executor';
await editorContext.openTaskEditDialog(50, row => { savedRow = row; });
assert.equal(editText.readOnly, true);
assert.equal(fields.reply.readOnly, false);
assert.equal(fields.completed.disabled, true);
assert.equal(fields.highlight.disabled, true);
assert.equal(fields.delete.hidden, true);
assert.equal(submit.hidden, false);
assert.equal(fields['order-field-text-value'].disabled, false, 'executor can edit the source order field');
assert.match(modal.innerHTML, /Ответ на задачу/);
fields.reply.value = 'Новый ответ';
await form.emit('submit');
assert.equal(patchSent.executor_reply, 'Новый ответ');
assert.deepEqual(Object.keys(patchSent), ['executor_reply']);
assert.equal(savedRow.executor_reply, 'Новый ответ');
assert.ok(updateFilters.some(([key, value]) => key === 'executor_reply' && value === 'Старый ответ'));
assert.ok(updateFilters.some(([key, value]) => key === 'executor_emails' && value[0] === 'worker@example.com'));

role = 'viewer';
await editorContext.openTaskEditDialog(50);
assert.equal(editText.readOnly, true);
assert.equal(fields.reply.readOnly, true);
assert.equal(fields.completed.disabled, true);
assert.equal(fields.highlight.disabled, true);
assert.equal(fields.delete.hidden, true);
assert.equal(submit.hidden, true);
assert.equal(fields['order-field-text-value'].disabled, true, 'viewer cannot edit the source order field');
assert.match(modal.innerHTML, /Просмотр задачи/);
modal.close();

role = 'both';
await editorContext.openTaskEditDialog(50, row => { savedRow = row; });
assert.equal(editText.readOnly, false, 'author-executor can edit the task text');
assert.equal(fields.reply.readOnly, false, 'author-executor can edit the reply');
assert.equal(fields.completed.disabled, false, 'author-executor keeps author completion rights');
assert.equal(fields.delete.hidden, false, 'author-executor keeps author deletion rights');
editText.value = 'Объединённая правка';
fields.reply.value = 'Ответ автора-исполнителя';
await form.emit('submit');
assert.equal(patchSent.body, 'Объединённая правка');
assert.equal(patchSent.executor_reply, 'Ответ автора-исполнителя');
assert.equal(savedRow.body, 'Объединённая правка');
assert.equal(savedRow.executor_reply, 'Ответ автора-исполнителя');

role = 'executor'; conflict = true;
await editorContext.openTaskEditDialog(50);
fields.reply.value = 'Conflict';
await form.emit('submit');
assert.equal(modal.open, true);
assert.match(fields.error.textContent, /Ответ уже изменён/);
modal.close();
conflict = false;

role = 'author';
await editorContext.openTaskEditDialog(50);
await fields.delete.emit('click');
assert.equal(deletedId, 50);
assert.equal(modal.open, true, 'cancelled/failed deletion keeps editor open');
deleteResult = true;
await fields.delete.emit('click');
assert.equal(modal, null, 'successful soft deletion closes editor');
console.log('shared edit dialog: author, executor, combined and viewer permissions, conflict handling and soft deletion passed');
