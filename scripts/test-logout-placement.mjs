import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const historySource = await readFile(new URL("../history.html", import.meta.url), "utf8");
const mainSource = await readFile(new URL("../js/main.js", import.meta.url), "utf8");
const historyJsSource = await readFile(new URL("../js/history.js", import.meta.url), "utf8");
const domSource = await readFile(new URL("../js/dom.js", import.meta.url), "utf8");
const styleSource = await readFile(new URL("../style.css", import.meta.url), "utf8");

assert.doesNotMatch(indexSource, /id="logoutBtn"/);
assert.doesNotMatch(historySource, /id="logoutBtn"/);
assert.doesNotMatch(mainSource, /getElementById\("logoutBtn"\)/);
assert.doesNotMatch(historyJsSource, /getElementById\("logoutBtn"\)/);
assert.doesNotMatch(domSource, /logoutBtn/);

const settingsStart = indexSource.indexOf('id="section-settings"');
const logoutButton = indexSource.indexOf('id="settingsLogoutBtn"');
const firstSettingsCard = indexSource.indexOf('id="settingsPhotoCooldownCard"');
assert.ok(settingsStart >= 0 && logoutButton > settingsStart && logoutButton < firstSettingsCard);
assert.match(indexSource, /id="settingsLogoutBtn"[^>]*>Выйти из системы<\/button>/);
assert.match(mainSource, /getElementById\("settingsLogoutBtn"\)\?\.addEventListener\("click", logout\)/);

assert.match(styleSource, /\.topbar-toolbar\s*\{[\s\S]*?justify-content: flex-end;[\s\S]*?margin-left: auto;/);
assert.match(styleSource, /\.topbar-user-name\s*\{[\s\S]*?text-align: right;/);
assert.match(styleSource, /#section-settings \.settings-logout-btn/);
assert.doesNotMatch(styleSource, /\.logout-icon-btn/);

console.log("logout placement tests: ok");
