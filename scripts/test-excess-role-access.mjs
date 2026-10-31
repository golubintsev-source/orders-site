import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const state = {};
const ctx = vm.createContext({state});
const source = fs.readFileSync(new URL("../js/roles.js", import.meta.url), "utf8");
vm.runInContext(source.replace(/^import .*;\n/gm, "").replace(/export /g, ""), ctx);
for (const role of ["admin", "user", "user_lite", "user_shop", undefined, "unknown"]) {
  state.currentRole = role;
  const allowed = role === "admin" || role === "user";
  assert.equal(ctx.canAccessExcesses(), allowed, String(role));
  assert.equal(ctx.canAccessSection("excess"), allowed, String(role));
  assert.equal(ctx.isSectionHiddenFromNav("excess"), !allowed, String(role));
  assert.equal(ctx.canAccessSection("settings"), true);
}
console.log("Excess page: only admin/user can access, other roles have no menu item: OK");
