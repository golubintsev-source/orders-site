import assert from "node:assert/strict";
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
const sw = await readFile(new URL("../sw.js", import.meta.url), "utf8");

assert.match(source, /const canEditRow = canEditManualCalculations\(\) && !isSystemDeltaRow/);
assert.match(source, /if \(canEditManualCalculations\(\)\) \{[\s\S]*?querySelectorAll\("\.btn-edit"\)/);
assert.match(source, /if \(!canEditManualCalculations\(\)\) return/);
assert.match(source, /isSystemDeltaCalculationComment\(data\.comment\)/);
assert.match(source, /isSystemDeltaCalculationComment\(currentRow\.comment\)/);
assert.match(sw, /orders-site-static-v75/);

console.log("calculations user edit tests: ok");
