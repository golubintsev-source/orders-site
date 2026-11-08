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
let serverRows = [task]; let found = null; let lookupFailed = false; let lookupFilters = [];
const links = vm.createContext({
  document: root, buildOrderCellHighlights, validOrderField,
  supabaseClient: { from: () => ({ select() { return this; }, is() { return this; }, or() { return this; }, order() { return this; }, eq(key, value) { lookupFilters.push([key, value]); return this; }, limit() { return this; }, maybeSingle: async () => ({ data: found, error: lookupFailed ? new Error("denied") : null }) }) },
  fetchAllSupabaseRows: async () => ({ data: serverRows, error: null }),
  isUserAuthorOfTask: () => true, isUserExecutorOfTask: () => false, taskLinkedOrderIds: row => [row.order_id],
});
vm.runInContext(fs.readFileSync(new URL('../js/order-task-links.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, ''), links);
await links.refreshActiveTaskOrderRefs();
assert.ok(classes.has('order-cell-task-pending'));
serverRows = [{ ...task, is_completed: true }]; await links.refreshActiveTaskOrderRefs();
assert.ok(classes.has('order-cell-task-completed')); assert.ok(!classes.has('order-cell-task-pending'));
serverRows = []; await links.refreshActiveTaskOrderRefs(); assert.equal(classes.size, 0);
found = { id: 9, order_id: 42, source_order_field: 'client', is_completed: true };
assert.equal((await links.findOrderCellTask(42, 'client')).id, 9);
assert.deepEqual(lookupFilters, [['order_id', 42], ['source_order_field', 'client']]);
found = null;
assert.equal(await links.findOrderCellTask(42, 'client'), null);
lookupFailed = true;
await assert.rejects(() => links.findOrderCellTask(42, 'client'), /Не удалось проверить/);
console.log('cell highlights: status, priority, deleted and legacy tasks, server lookup and DOM transitions passed');
