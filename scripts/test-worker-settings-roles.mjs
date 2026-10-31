import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
class Element {
  hidden = true;
  constructor(worker = false, id = "") { this.id = id; this.worker = worker; }
  classList = { contains: name => name === "settings-worker-editable" && this.worker };
  querySelectorAll() { return [{ value: "Работник" }]; }
  appendChild() {}
  setAttribute() {}
}
const blocks = [new Element(true), new Element(true), new Element(true), new Element(), new Element(false, "loginLinksCard")];
const state = {};
const writes = [];
const ctx = vm.createContext({
  state, HTMLElement: Element,
  document: {
    getElementById: id => /settings(?:OtherWorkers|Editors)List/.test(id) ? new Element() : null,
    querySelectorAll: () => blocks, createElement: () => new Element(),
  },
  supabaseClient: { from: table => ({ upsert: async row => { assert.equal(table, "app_settings"); writes.push(row); return { error: null }; } }) },
});
const strip = text => text.replace(/^import .*;\n/gm, "").replace(/export /g, "");
vm.runInContext(strip(fs.readFileSync(new URL("../js/roles.js", import.meta.url), "utf8")), ctx);
vm.runInContext(strip(fs.readFileSync(new URL("../js/settings.js", import.meta.url), "utf8")), ctx);
for (const role of ["admin", "user", "user_lite", "user_shop", undefined]) {
  state.currentRole = role;
  const allowed = role === "admin" || role === "user";
  assert.equal(ctx.canManageWorkerSettings(), allowed);
  ctx.applySettingsAdminBlocksVisibility();
  assert.deepEqual(blocks.slice(0, 3).map(b => !b.hidden), [allowed, allowed, allowed]);
  assert.equal(!blocks[3].hidden, role === "admin");
  const before = writes.length;
  assert.equal(await ctx.saveDriverName("Водитель"), allowed);
  assert.equal(await ctx.saveEditors(), allowed);
  assert.equal(await ctx.saveOtherWorkers(), allowed);
  assert.equal(writes.length - before, allowed ? 3 : 0);
  if (role === "user") {
    assert.equal(await ctx.saveInstallerRate("1500"), false);
    assert.equal(await ctx.saveManagerSalaryParams(), false);
    assert.equal((await ctx.saveBalanceAdjustments()).ok, false);
  }
}
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.equal((html.match(/settings-worker-editable/g) || []).length, 3);
console.log("Worker settings: visibility and saves for all roles, admin settings remain restricted: OK");
