import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const listeners = new Map();
let observer;
const window = { addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) };
const field = { clientWidth: 250, clientHeight: 38, offsetHeight: 40, scrollHeight: 38, style: {}, listeners: new Map(),
  addEventListener(type, fn) { this.listeners.set(type, fn); }, removeEventListener(type) { this.listeners.delete(type); } };
const context = vm.createContext({ window, ResizeObserver: class {
  constructor(fn) { this.fn = fn; observer = this; } observe() {} disconnect() { this.disconnected = true; }
} });
vm.runInContext(fs.readFileSync(new URL('../js/autogrow-textarea.js', import.meta.url), 'utf8').replace(/export /g, ''), context);
const cleanup = context.bindAutogrowTextarea(field);
assert.equal(field.style.height, '40px');
assert.equal(context.bindAutogrowTextarea(field), cleanup, 'binding must be idempotent');
field.scrollHeight = 98; field.listeners.get('input')(); assert.equal(field.style.height, '100px');
field.scrollHeight = 38; field.listeners.get('input')(); assert.equal(field.style.height, '40px');
field.scrollHeight = 78; observer.fn([{ contentRect: { width: 180 } }]); assert.equal(field.style.height, '80px');
field.clientWidth = 0; field.scrollHeight = 200; field.listeners.get('input')(); assert.equal(field.style.height, '80px');
field.clientWidth = 250; field.scrollHeight = 38; listeners.get('resize')(); assert.equal(field.style.height, '40px');
cleanup(); assert.equal(field.listeners.size, 0); assert.equal(listeners.size, 0); assert.equal(observer.disconnected, true);
context.bindAutogrowTextarea(field); assert.equal(field.listeners.size, 1);
console.log('textarea: one-line baseline, input grow/shrink, width changes, hidden field, duplicate binding and close cleanup passed');
