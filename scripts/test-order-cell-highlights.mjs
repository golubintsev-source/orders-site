import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildOrderCellHighlights, validOrderField } from '../js/order-cell-highlights.js';
const task = { order_id: 42, source_order_field: 'client', highlight_order_field: true, is_completed: false };
const status = rows => buildOrderCellHighlights(rows).get('42:client');
assert.equal(status([task]), 'pending');
assert.equal(status([{ ...task, is_completed: true }]), 'completed');
assert.equal(status([{ ...task, highlight_order_field: false }]), undefined);
assert.equal(status([{ ...task, is_completed: true, highlight_order_field: false }]), undefined);
assert.equal(status([{ ...task, deleted_at: '2026-11-01' }]), undefined);
assert.equal(status([{ order_id: 42, is_completed: false }]), undefined);
assert.equal(status([task, { ...task, is_completed: true }]), 'pending');
assert.equal(status([{ ...task, is_completed: true }, task]), 'pending');
assert.equal(status([{ ...task, source_order_field: 'address' }]), undefined);
assert.equal(validOrderField('invalid'), null);
const classes = new Set();
const cell = { dataset: { orderField: 'client' }, classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) } };
const idCell = { getAttribute: () => '42', querySelector: () => null, closest: () => ({ querySelectorAll: () => [cell] }) };
const root = { querySelectorAll: () => [idCell] };
let serverRows = [task]; let pending = [];
const links = vm.createContext({
  document: root, buildOrderCellHighlights,
  supabaseClient: { from: () => ({ select() { return this; }, is() { return this; }, or() { return this; }, order() { return this; } }) },
  fetchAllSupabaseRows: async () => ({ data: serverRows, error: null }),
  readPendingTasksQueueForMessageLinks: () => pending,
  isUserAuthorOfTask: () => true, isUserExecutorOfTask: () => false, taskLinkedOrderIds: row => [row.order_id],
});
vm.runInContext(fs.readFileSync(new URL('../js/order-task-links.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, ''), links);
await links.refreshActiveTaskOrderRefs();
assert.ok(classes.has('order-cell-task-pending'));
serverRows = [{ ...task, is_completed: true }]; await links.refreshActiveTaskOrderRefs();
assert.ok(classes.has('order-cell-task-completed')); assert.ok(!classes.has('order-cell-task-pending'));
serverRows = []; await links.refreshActiveTaskOrderRefs(); assert.equal(classes.size, 0);
pending = [task]; await links.refreshActiveTaskOrderRefs(); assert.ok(classes.has('order-cell-task-pending'));
pending[0] = { ...task, is_completed: true }; await links.refreshActiveTaskOrderRefs(); assert.ok(classes.has('order-cell-task-completed'));
pending = []; await links.refreshActiveTaskOrderRefs(); assert.equal(classes.size, 0);
// Exercise the actual offline queue, display and synchronization functions.
const offlineSource = fs.readFileSync(new URL('../js/offline-cache.js', import.meta.url), 'utf8');
let queue = []; let saved;
const offline = vm.createContext({
  console, readPendingTasksQueue: () => queue, writePendingTasksItems: rows => { queue = rows; },
  supabaseClient: { from: () => ({ insert: async payload => { saved = payload; return { error: null }; } }) },
});
for (const name of ['addPendingOfflineTask', 'pendingTaskDisplayRows', 'syncPendingTasksToSupabase']) {
  const fn = offlineSource.match(new RegExp(`(?:export )?(?:async )?function ${name}\\([^]*?\\n\\}(?=\\n|$)`))[0].replace('export ', '');
  vm.runInContext(fn, offline);
}
offline.addPendingOfflineTask({ localId: 'x', tempTaskId: -1, order_id: 42, body: 'Cell task', source_order_field: 'client', highlight_order_field: true });
assert.equal(offline.pendingTaskDisplayRows()[0].source_order_field, 'client');
assert.equal(offline.pendingTaskDisplayRows()[0].highlight_order_field, true);
await offline.syncPendingTasksToSupabase();
assert.equal(saved.source_order_field, 'client'); assert.equal(saved.highlight_order_field, true); assert.equal(queue.length, 0);
console.log('cell highlights: four checkbox/status cases, priority, deleted/legacy tasks, correct cell, DOM transitions and offline round trip passed');
