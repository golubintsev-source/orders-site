import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("section dropdown follows the requested order and labels", async () => {
  const [html, historyHtml, nav, boot, style] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../history.html", import.meta.url), "utf8"),
    readFile(new URL("../js/section-nav.js", import.meta.url), "utf8"),
    readFile(new URL("../js/boot-route.js", import.meta.url), "utf8"),
    readFile(new URL("../style.css", import.meta.url), "utf8"),
  ]);
  const panel = html.match(/<div class="section-nav-dropdown-panel" id="sectionNavDropdownPanel"[\s\S]*?<div class="section-nav-dropdown-footer">/)?.[0] || "";
  const actual = [...panel.matchAll(/data-section="([^"]+)"/g)].map((match) => match[1]);
  const expected = [
    "all", "new", "calculations", "all-salaries", "excess", "debts", "manager-salary", "route-sheet", "contractor-checks", "balance",
    "statistics-balance", "changes-all", "statistics", "speed-test", "voice", "settings",
  ];

  assert.deepEqual(actual, expected);
  assert.match(panel, /data-section="all-salaries"[\s\S]*?>Зарплаты<\/span>/);
  assert.match(nav, /"all-salaries": "Зарплаты"/);
  assert.match(boot, /"all-salaries": "Зарплаты"/);
  assert.match(panel, /data-section="new"[\s\S]*?>Новый заказ<\/span>/);
  assert.match(panel, /data-section="statistics"[\s\S]*?>Статистика входов<\/span>/);
  assert.match(nav, /statistics: "Статистика входов"/);
  assert.match(boot, /statistics: "Статистика входов"/);
  assert.ok(html.indexOf('id="sectionNavCurrentBtn"') < html.indexOf('class="topbar-orders-type-tools"'));
  assert.match(style, /\.topbar-orders-type-tools\s*\{[\s\S]*?margin-left: auto;/);
  assert.doesNotMatch(panel, /data-section="tasks-all"|>Мои задачи<\/span>/);
  assert.doesNotMatch(historyHtml, /data-section="tasks-all"/);
  assert.match(html, /id="myTasksNavBtn"/);
  assert.equal((html.match(/<!DOCTYPE html>/gi) || []).length, 1);
  assert.equal((html.match(/<body(?:\s|>)/gi) || []).length, 1);
  assert.equal((html.match(/id="startupScreen"/g) || []).length, 1);
  assert.equal((html.match(/id="appContainer"/g) || []).length, 1);
});
