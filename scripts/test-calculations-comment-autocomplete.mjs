import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const calculations = await readFile(new URL("../js/calculations.js", import.meta.url), "utf8");
const autocomplete = await readFile(new URL("../js/clientAutocomplete.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const style = await readFile(new URL("../style.css", import.meta.url), "utf8");
const sw = await readFile(new URL("../sw.js", import.meta.url), "utf8");

assert.match(calculations, /import \{ attachFieldAutocomplete \} from "\.\/clientAutocomplete\.js"/);
assert.match(calculations, /async function loadCalcCommentSuggestions/);
assert.match(calculations, /fetchAllSupabaseRows\(\(\) =>[\s\S]*?\.from\("calculations"\)/);
assert.match(calculations, /if \(isSystemDeltaCalculationComment\(row\?\.comment\)\) continue/);
assert.match(calculations, /stripAuthorFromManualComment\(row\?\.comment\)/);
assert.match(calculations, /getSuggestions: getCalcCommentSuggestions/);
assert.match(calculations, /minChars: 1/);
assert.match(autocomplete, /typeof getSuggestions === "function"/);
assert.match(autocomplete, /input\.value\.trim\(\)\.length >= minChars/);
assert.match(html, /id="calcCommentSuggestions"/);
assert.match(html, /aria-controls="calcCommentSuggestions"/);
assert.match(style, /#section-calculations \.client-suggestions/);
assert.match(sw, /orders-site-static-v76/);

console.log("calculations comment autocomplete tests: ok");
