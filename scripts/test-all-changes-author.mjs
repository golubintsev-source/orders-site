import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../js/all-changes.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const sw = await readFile(new URL("../sw.js", import.meta.url), "utf8");

assert.match(source, /import \{ displayNameByEmail \} from "\.\/user-names\.js"/);
assert.match(source, /displayNameByEmail\(row\.user_email\) \|\| "—"/);
assert.doesNotMatch(source, /function formatLoginFive/);

const table = html.match(/<table id="allChangesTable">[\s\S]*?<\/table>/)?.[0] || "";
assert.match(table, /<th>Автор<\/th>/);
assert.doesNotMatch(table, /<th>Логин<\/th>/);
assert.match(sw, /orders-site-static-v74/);

console.log("all changes author tests: ok");
