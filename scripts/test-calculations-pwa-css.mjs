import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const handlers = {}, cached = [];
const sw = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const cacheName = sw.match(/const STATIC_CACHE = "([^"]+)"/)[1];
const ctx = vm.createContext({
  self: { addEventListener: (name, fn) => { handlers[name] = fn; }, skipWaiting: async () => {} },
  caches: { open: async name => { assert.equal(name, cacheName); return { put: async url => cached.push(url) }; } },
  fetch: async (url, options) => {
    assert.equal(options.cache, "reload");
    return { ok: true, clone() { return this; } };
  },
});
vm.runInContext(sw, ctx);
let pending;
handlers.install({ waitUntil: promise => { pending = promise; } });
await pending;
for (const file of ["index.html", "calculations.html"]) {
  const html = fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const cssUrl = html.match(/href="\.\/(style\.css\?[^"]+)"/)[1];
  assert.ok(cached.includes("/" + cssUrl), file + " CSS must be precached under the same URL");
}
const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
assert.ok(css.includes("@media (orientation: landscape) and (max-width: 1100px)"));
console.log("PWA cache install precaches the CSS version used by both calculations pages: OK");
