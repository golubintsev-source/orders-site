import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../js/orders.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const fn = source.match(/export function isInstallerRequiredMissing\([^]*?\n\}/)[0].replace("export ", "");
const ctx = vm.createContext({});
vm.runInContext(fn, ctx);

for (const payer of ["Дима", "Вова", "Касса", "Безнал"]) {
  for (const missing of ["", "   ", "—"]) assert.equal(ctx.isInstallerRequiredMissing(payer, missing), true);
  assert.equal(ctx.isInstallerRequiredMissing(payer, "Сергей и Стас"), false);
}

const installerBlock = html.match(/id="installer_payment_block"[\s\S]*?<\/div>\s*<\/div>/)?.[0] || "";
assert.doesNotMatch(installerBlock, />Монтажник</);
assert.doesNotMatch(installerBlock, />Оплатил</);
assert.doesNotMatch(source, /conditionalMissing\.push\("Монтажник"\)/);

console.log("installer fields: legacy helper remains, removed fields no longer block order saving");
