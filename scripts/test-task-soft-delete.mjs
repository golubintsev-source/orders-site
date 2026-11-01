import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../js/tasks.js', import.meta.url), 'utf8');
let confirmation = true, author = true, writeError = null, updated = [], history = [], refreshed = 0;
const existing = { id: 42, author_login: 'author@example.com', body: 'Сохранить исходный текст', order_id: 77 };
const hooks = { refreshActiveTaskMessageRefs() {}, refreshActiveTaskOrderRefs() {}, loadAllChanges() {} };
const context = vm.createContext({
  state: { currentUser: { email: existing.author_login } }, console: { error() {}, warn() {} },
  confirm: () => confirmation, window: { alert() {} }, isOfflineDataMode: () => false,
  isUserAuthorOfTask: () => author, TASK_SELECT_FIELDS: 'id,body',
  insertTaskHistoryComments: async (id, comments) => { history.push({ id, comments }); return { ok: true }; },
  loadAllTasks: async () => { refreshed++; }, loadOrderTasks() {}, refreshMyTasksNavBadge() {}, hooks,
  supabaseClient: { from: table => {
    assert.equal(table, 'order_tasks'); let updating = false;
    return { select() { return this; }, eq() { return this; }, is() { return this; },
      update(patch) { updating = true; updated.push(patch); return this; },
      maybeSingle: async () => ({ data: updating ? (writeError ? null : { id: 42 }) : existing, error: updating ? writeError : null }),
    };
  } },
});
for (const name of ['buildTaskHistoryDeleteComments', 'softDeleteAuthorTask']) {
  const fn = source.match(new RegExp(`(?:export )?(?:async )?function ${name}\\([^]*?\\n\\}`))[0]
    .replace('export ', '').replace(/import\("\.\/(?:message-task-links|order-task-links|all-changes)\.js"\)/g, 'Promise.resolve(hooks)');
  vm.runInContext(fn, context);
}
assert.equal(await context.softDeleteAuthorTask(42, null), true);
assert.deepEqual(Object.keys(updated[0]), ['deleted_at']);
assert.ok(Number.isFinite(Date.parse(updated[0].deleted_at)));
assert.equal(existing.body, 'Сохранить исходный текст');
assert.equal(history[0].id, 42); assert.equal(history[0].comments[0], 'Задача удалена');
assert.equal(refreshed, 1);
updated = []; confirmation = false;
assert.notEqual(await context.softDeleteAuthorTask(42, null), true); assert.equal(updated.length, 0);
confirmation = true; author = false;
assert.notEqual(await context.softDeleteAuthorTask(42, null), true); assert.equal(updated.length, 0);
author = true; writeError = { message: 'denied' }; history = [];
assert.notEqual(await context.softDeleteAuthorTask(42, null), true); assert.equal(history.length, 0);
console.log('soft deletion: deleted_at only, original task preserved, history and refresh, cancel, author guard and failed write passed');
