import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
let allowed = true, offline = false, pendingFound = true, pendingReply, calls = [], resolveWrite;
let sizedFields = [], disposedFields = [];
const context = vm.createContext({
  bindAutogrowTextarea: field => { sizedFields.push(field); return () => disposedFields.push(field); },
  getCurrentUserEmail: () => 'worker@example.com', isUserExecutorOfTask: () => allowed,
  isOfflineDataMode: () => offline, updatePendingTaskReply: (id, reply) => { pendingReply = reply; return pendingFound; },
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
allowed = true; offline = true;
assert.equal((await context.saveExecutorReply(row, 'No', '')).ok, false);
assert.equal((await context.saveExecutorReply({ ...row, __offlineLocalId: 'local' }, 'Local', '')).ok, true);
assert.equal(pendingReply, 'Local'); pendingFound = false;
assert.equal((await context.saveExecutorReply({ ...row, __offlineLocalId: 'local' }, 'Local', '')).ok, false);
assert.ok(!context.renderTaskReplyCell({ ...row, id: 43, executor_reply: '</textarea><script>x</script>' }).includes('<script>'));
controls.input.isConnected = false;
root.editor = { querySelector: () => ({ isConnected: true }) };
context.resizeTaskReplyFields(root);
assert.equal(disposedFields.length, 1, 're-render removes sizing handlers for old fields');
console.log('task replies: grey/green dirty state, save, duplicate prevention, edit/clear, errors/conflict, draft preservation, executor guard, offline task and escaping passed');
// Exercise the real shared edit dialog used from both task lists and order cells.
let modal = null, patchSent, updateFilters, canReply = true, conflict = false, savedRow;
const editorSizedFields = [];
const node = () => ({ value: '', checked: false, disabled: false, dataset: {}, hidden: true, listeners: {},
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }, focus() {}, append() {}, appendChild() {},
  querySelector() { return null; }, querySelectorAll() { return []; },
  async emit(type) { for (const fn of this.listeners[type] || []) await fn({ preventDefault() {} }); } });
let fields, form, editText, executors, submit;
const document = {
  getElementById: id => id === 'taskEditDialog' ? modal : null,
  body: { append(dialog) { modal = dialog; dialog.isConnected = true; } },
  createElement() {
    fields = Object.fromEntries(['reply','highlight','hint','due','error'].map(key => [key, node()]));
    form = node(); editText = node(); executors = node(); submit = node(); const cancel = node();
    form.querySelectorAll = () => [...Object.values(fields), editText, submit, cancel];
    const dialog = node(); dialog.setAttribute = () => {};
    dialog.querySelector = selector => {
      const field = selector.match(/^\[data-field="([^"]+)"\]$/)?.[1];
      if (field) return fields[field];
      return ({ form, '#taskEditExecutors': executors, '[type="submit"]': submit, '.task-create-dialog-cancel': cancel, '#taskEdit-orderTaskTextInput': editText })[selector] || null;
    };
    dialog.showModal = () => { dialog.open = true; };
    dialog.remove = () => { modal = null; dialog.isConnected = false; };
    dialog.close = () => { dialog.open = false; for (const fn of dialog.listeners.close || []) fn(); };
    return dialog;
  },
};
const taskRow = { id: 50, author_login: 'worker@example.com', body: 'Задача', executor_emails: ['worker@example.com'], executor_reply: 'Старый ответ' };
const editorContext = vm.createContext({
  document, console, isOfflineDataMode: () => false, bindAutogrowTextarea: field => { editorSizedFields.push(field); return () => {}; },
  isUserAuthorOfTask: () => true, isUserExecutorOfTask: () => canReply,
  getCurrentUserEmail: () => 'worker@example.com', normalizeExecutorEmails: () => [],
  getSelectedExecutorEmailsFrom: () => ['worker@example.com'], datetimeLocalToIso: () => null,
  ensureTaskExecutorsInList: async list => { list.dataset.loaded = '1'; }, renderTaskComposerHtml: () => '',
  createTaskAttachmentComposer: () => ({ init() {}, dispose() {}, setBusy() {}, hasAttachments: () => false, prepare: async () => [] }),
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
vm.runInContext(editSource.replace(/^import[^]*?from "[^"]+";\n/gm, '').replace(/export /g, ''), editorContext);
await editorContext.openTaskEditDialog(50, row => { savedRow = row; });
assert.equal(fields.reply.value, 'Старый ответ'); assert.equal(fields.reply.readOnly, false);
assert.equal(editText.rows, 1);
assert.match(modal.innerHTML, /data-field="reply" rows="1"/);
assert.ok(editorSizedFields.includes(fields.reply));
assert.ok(modal.innerHTML.indexOf('Ответ') > modal.innerHTML.indexOf('Исполнители'));
fields.reply.value = 'Новый ответ'; await form.emit('submit');
assert.equal(patchSent.executor_reply, 'Новый ответ'); assert.equal(savedRow.executor_reply, 'Новый ответ');
assert.ok(updateFilters.some(([key, value]) => key === 'executor_reply' && value === 'Старый ответ'));
canReply = false;
await editorContext.openTaskEditDialog(50);
assert.equal(fields.reply.value, 'Старый ответ'); assert.equal(fields.reply.readOnly, true);
fields.reply.value = 'Cannot change'; await form.emit('submit');
assert.equal(Object.hasOwn(patchSent, 'executor_reply'), false, 'author-only edits must not overwrite executor reply');
canReply = true; conflict = true;
await editorContext.openTaskEditDialog(50);
fields.reply.value = 'Conflict'; await form.emit('submit');
assert.equal(modal.open, true); assert.match(fields.error.textContent, /Ответ уже изменён/);
modal.close();
console.log('shared edit dialog: reply below executors, editable for executor, read-only for author, unchanged reply preserved and conflict handled');
let queue = [{ localId: 'local', tempTaskId: -1, executor_reply: '' }], synced;
const offlineContext = vm.createContext({
  console, readPendingTasksQueue: () => queue, writePendingTasksItems: rows => { queue = rows; },
  supabaseClient: { from: () => ({ insert: async payload => { synced = payload; return { error: null }; } }) },
});
const offlineSource = fs.readFileSync(new URL('../js/offline-cache.js', import.meta.url), 'utf8');
for (const name of ['updatePendingTaskReply', 'pendingTaskDisplayRows', 'syncPendingTasksToSupabase']) {
  vm.runInContext(offlineSource.match(new RegExp(`(?:export )?(?:async )?function ${name}\\([^]*?\\n\\}(?=\\n|$)`))[0].replace('export ', ''), offlineContext);
}
assert.equal(offlineContext.updatePendingTaskReply('local', 'Офлайн ответ'), true);
assert.equal(offlineContext.pendingTaskDisplayRows()[0].executor_reply, 'Офлайн ответ');
await offlineContext.syncPendingTasksToSupabase();
assert.equal(synced.executor_reply, 'Офлайн ответ'); assert.equal(queue.length, 0);
console.log('offline executor reply survives queue update, display and database synchronization');
