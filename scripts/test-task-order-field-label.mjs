import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { orderFieldLabel, ORDER_TABLE_FIELD_KEYS } from '../js/order-cell-highlights.js';
for (const field of ORDER_TABLE_FIELD_KEYS) assert.equal(typeof orderFieldLabel(field), 'string');
assert.equal(orderFieldLabel('client'), 'Клиент');
assert.equal(orderFieldLabel('address'), 'Адрес');
assert.equal(orderFieldLabel('__proto__'), '');
assert.equal(orderFieldLabel(null), '');
const source = fs.readFileSync(new URL('../js/tasks.js', import.meta.url), 'utf8');
const context = vm.createContext({
  orderFieldLabel,
  taskLinkedOrderIds: row => row.ids || (row.order_id ? [row.order_id] : []),
  formatTaskOrderLabel: id => `${String(id).padStart(4, '0')}_О`,
  escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
  buildOrderEditUrl: id => `/new?edit_order_id=${id}`,
  isActiveTask: row => !row.is_completed,
  formatTaskExecutors: () => '', normalizeExecutorEmails: () => [], visibleTaskExecutorEmails: () => [], displayNameByEmail: String,
  formatTaskAuthorName: () => '', formatTaskDateRu: () => '', renderTaskTextCellHtml: () => '<td>Задача</td>',
  renderAuthorTaskDeleteCell: () => '', renderMyTaskStatusCell: () => '',
});
for (const name of ['renderTaskOrderCellHtml', 'renderMyTasksRow', 'renderMyAuthorTasksRow']) {
  const fn = source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0];
  vm.runInContext(fn, context);
}
const row = { order_id: 42, source_order_field: 'client', ids: [42, 44] };
for (const render of [context.renderMyTasksRow, context.renderMyAuthorTasksRow]) {
  const html = render(row, { showOrder: true });
  assert.match(html, />0042_О Клиент<\/a>/);
  assert.match(html, /href="\/new\?edit_order_id=42"/);
  assert.match(html, />0044_О<\/a>/);
  assert.doesNotMatch(html, /0044_О Клиент/);
  assert.match(render({ order_id: 42 }, { showOrder: true }), />0042_О<\/a>/);
  assert.match(render({ ...row, source_order_field: 'address' }, { showOrder: true }), />0042_О Адрес<\/a>/);
  assert.doesNotMatch(render({ ...row, source_order_field: '<script>' }, { showOrder: true }), /<script>/);
}
console.log('task order labels: both task tables, field label, original order only, ordinary tasks and unknown fields passed');

const replyHtml = context.renderMyAuthorTasksRow({ order_id: 42, executor_reply: 'Ответ <текст>\nВторая строка' }, { showOrder: true, showReply: true });
assert.match(replyHtml, /class="task-reply-readonly">Ответ &lt;текст&gt;\nВторая строка<\/td>/);
assert.doesNotMatch(replyHtml, /textarea|task-reply-save/);
const ordinaryAuthorRow = context.renderMyAuthorTasksRow({ executor_reply: 'Ответ' });
assert.doesNotMatch(ordinaryAuthorRow, /task-reply-readonly/);
console.log('author reply column: plain read-only text, escaped content and optional table column passed');
