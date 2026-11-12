import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { state } from "../js/state.js";
import { canEditManualCalculations } from "../js/roles.js";

const previousRole = state.currentRole;
state.currentRole = "admin";
assert.equal(canEditManualCalculations(), true);
state.currentRole = "user";
assert.equal(canEditManualCalculations(), true);
state.currentRole = "user_lite";
assert.equal(canEditManualCalculations(), false);
state.currentRole = "user_shop";
assert.equal(canEditManualCalculations(), false);
state.currentRole = previousRole;

const source = await readFile(new URL("../js/calculations.js", import.meta.url), "utf8");
const style = await readFile(new URL("../style.css", import.meta.url), "utf8");
const sw = await readFile(new URL("../sw.js", import.meta.url), "utf8");

assert.match(source, /const canEditRow = canEditManualCalculations\(\) && !isSystemDeltaRow/);
assert.match(source, /if \(canEditManualCalculations\(\)\) \{[\s\S]*?querySelectorAll\("\.btn-edit"\)/);
assert.match(source, /if \(!canEditManualCalculations\(\)\) return/);
assert.match(source, /isSystemDeltaCalculationComment\(row\.comment\)/);
assert.match(source, /isSystemDeltaCalculationComment\(currentRow\.comment\)/);
assert.match(source, /class="calc-actions-grid"/);
assert.match(style, /\.calc-actions-grid \.btn-delete-calc[\s\S]*grid-column:\s*2/);
assert.ok(Number(sw.match(/const STATIC_CACHE = "orders-site-static-v(\d+)"/)?.[1]) >= 128);

// Opening, cancelling and saving a row use the dialog fields and preserve the add form.
function element() {
  return {
    handlers: new Map(),
    addEventListener(name, handler) { this.handlers.set(name, handler); },
    fire(name, event = {}) { return this.handlers.get(name)?.(event); },
    focus() { this.focused = true; },
  };
}
const cancel = element();
const save = element();
const editForm = element();
const dialog = Object.assign(element(), {
  open: false, offsetWidth: 340, offsetHeight: 240, style: {},
  setAttribute() {},
  querySelector(selector) {
    if (selector === "form") return editForm;
    return selector.includes("submit") ? save : cancel;
  },
  showModal() { this.open = true; },
  close() { this.open = false; this.fire("close"); },
});
const button = Object.assign(element(), {
  isConnected: true,
  dataset: { id: "42" },
  getBoundingClientRect: () => ({ right: 385, top: 345, bottom: 375 }),
});
const addComment = { value: "Черновик новой записи" };
const fields = Object.fromEntries(["from", "to", "amount", "comment", "error"].map(key => [key, element()]));
const row = { id: 42, from_place: "Дима", to_place: "Зарплата", amount: 70000, comment: "з/п Иван Сотников, Возврат долга; Дима" };
const writes = [];
const refreshes = [];
let nextResult;
const context = vm.createContext({
  document: {
    documentElement: { clientWidth: 390, clientHeight: 720 },
    createElement: () => dialog,
    getElementById: id => id === "calcComment" ? addComment : {},
    querySelector: () => button,
  },
  window: element(),
  calculationEditDialog: null,
  calculationEdit: null,
  calculationEditSaving: false,
  calculationsLoadFailed: false,
  calculationsRowsCache: [row],
  canEditManualCalculations: () => true,
  isSystemDeltaCalculationComment: () => false,
  calculationFormFields: prefix => {
    assert.equal(prefix, "calcEdit");
    return fields;
  },
  bindCalculationFields() {},
  configureCalcPlaces(target, current) {
    target.from.value = current.from_place;
    target.to.value = current.to_place;
  },
  formatAmountWholeRubles: String,
  refreshRublesIntegerInputState() {},
  stripAuthorFromManualComment: comment => comment.split(";")[0],
  resizeTextarea() {},
  setFormError: (el, text = "") => { el.textContent = text; },
  getFormValues: ({ amount }) => ({ amount: Number(amount.value) }),
  validateCalculation: () => "",
  async saveCalculationEdit(current, payload) {
    writes.push({ id: current.id, amount: payload.amount });
    return nextResult;
  },
  async loadCalculations({ force }) { refreshes.push(force); },
  setMessage() {},
  loadCalcCommentSuggestions() {},
});
for (const name of ["positionCalculationEditDialog", "setupCalculationEditDialog", "startEdit"]) {
  const fn = source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0];
  vm.runInContext(fn, context);
}
context.setupCalculationEditDialog({ after: node => assert.equal(node, dialog) });
context.startEdit(button);
assert.equal(dialog.open, true);
assert.equal(fields.from.value, "Дима");
assert.equal(fields.to.value, "Зарплата");
assert.equal(fields.amount.value, "70000");
assert.equal(fields.comment.value, "з/п Иван Сотников, Возврат долга");
assert.equal(dialog.style.top, "383px");
fields.comment.value = "Отменённое изменение";
cancel.fire("click");
assert.equal(dialog.open, false);
assert.equal(button.focused, true);
assert.equal(writes.length, 0);

context.startEdit(button);
assert.equal(fields.comment.value, "з/п Иван Сотников, Возврат долга");
fields.amount.value = "75000";
nextResult = { message: "Ошибка при сохранении." };
const submit = () => editForm.fire("submit", { preventDefault() {} });
await submit();
assert.equal(dialog.open, true);
assert.equal(fields.error.textContent, nextResult.message);
assert.equal(fields.amount.value, "75000");
assert.equal(save.disabled, false);
assert.equal(refreshes.length, 0);

nextResult = { updatedRow: { ...row, amount: 75000 }, historyOk: true };
await Promise.all([submit(), submit()]);
assert.deepEqual(writes, [{ id: 42, amount: 75000 }, { id: 42, amount: 75000 }]);
assert.deepEqual(refreshes, [true]);
assert.equal(dialog.open, false);
assert.equal(addComment.value, "Черновик новой записи");

console.log("calculations user edit tests: ok");
