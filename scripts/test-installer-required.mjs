import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../js/orders.js", import.meta.url), "utf8");
const functions = ["isInstallerRequiredMissing", "updateConditionalRequiredHighlight"].map(name =>
  source.match(new RegExp("export function " + name + "\\([^]*?\\n\\}"))[0].replace("export ", "")
).join("\n");
const fields = {};
const installer = fields.installer_name = {
  value: "", attributes: {}, invalid: false,
  classList: { toggle(name, enabled) { if (name === "conditional-invalid") installer.invalid = enabled; } },
  setAttribute(name, value) { this.attributes[name] = value; },
  removeAttribute(name) { delete this.attributes[name]; },
};
fields.installer_payment_by = { value: "" };
const ctx = vm.createContext({ document: { getElementById: id => fields[id] }, parseOrderFormDdMmYyyyToIso: () => null });
vm.runInContext(functions, ctx);
for (const payer of ["Дима", "Вова", "Касса", "Безнал"]) {
  for (const missing of ["", "   ", "—"]) assert.equal(ctx.isInstallerRequiredMissing(payer, missing), true);
  assert.equal(ctx.isInstallerRequiredMissing(payer, "Сергей и Стас"), false);
}
for (const payer of ["", " ", "—", null]) assert.equal(ctx.isInstallerRequiredMissing(payer, ""), false);
fields.installer_payment_by.value = "Касса";
ctx.updateConditionalRequiredHighlight();
assert.equal(installer.invalid, true);
assert.equal(installer.attributes["aria-required"], "true");
assert.equal(installer.attributes["aria-invalid"], "true");
installer.value = "Иван Сотников";
ctx.updateConditionalRequiredHighlight();
assert.equal(installer.invalid, false);
assert.equal(installer.attributes["aria-invalid"], undefined);
installer.value = "";
fields.installer_payment_by.value = "";
ctx.updateConditionalRequiredHighlight();
assert.equal(installer.invalid, false);
assert.equal(installer.attributes["aria-required"], "false");
console.log("installer required: payer/name combinations and live highlight passed");

const submit = source.match(/export async function submitOrderForm\(event\) \{[^]*?\n\}/)[0].replace("export ", "");
Object.assign(fields, {
  client: { value: "Клиент", classList: { add() {}, remove() {} } },
  address: { value: "Адрес", classList: { add() {}, remove() {} } },
  payment_status: { value: "Производство", classList: { add() {}, remove() {} } },
});
installer.focus = () => { ctx.focusedInstaller = true; };
Object.assign(ctx, {
  state: { viewingOrderId: null, editingOrderId: null, initialOrderParticipants: {} },
  orderFormSaveInFlight: false, setOrderFormInvalidDateMessage() {},
  setOrderFormSaveButtonsBusy() {}, canMutateOrders: () => true,
  isUserLite: () => false, isUserShop: () => false, isAdmin: () => true,
  updatePaidField() {}, isOrderDateMissing: () => false,
  hasInvalidOrderFormDateInput: () => false, isForbiddenKassaBeznalSelection: () => false,
  setMessage: message => { ctx.message = message; },
});
vm.runInContext(submit, ctx);
for (const editingOrderId of [null, 863]) {
  ctx.state.editingOrderId = editingOrderId;
  fields.installer_payment_by.value = "Дима";
  installer.value = "";
  await ctx.submitOrderForm({ preventDefault() {} });
  assert.equal(ctx.message, "Заполните поля: Монтажник");
  assert.equal(ctx.focusedInstaller, true);
}
console.log("create and edit submissions blocked before persistence when installer is missing");
