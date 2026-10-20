import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("section dropdown follows the requested order and labels", async () => {
  const [html, nav, boot] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../js/section-nav.js", import.meta.url), "utf8"),
    readFile(new URL("../js/boot-route.js", import.meta.url), "utf8"),
  ]);
  const panel = html.match(/<div class="section-nav-dropdown-panel" id="sectionNavDropdownPanel"[\s\S]*?<div class="section-nav-dropdown-footer">/)?.[0] || "";
  const actual = [...panel.matchAll(/data-section="([^"]+)"/g)].map((match) => match[1]);
  const expected = [
    "all", "new", "calculations", "excess", "debts", "manager-salary",
    "all-salaries", "tasks-all", "route-sheet", "contractor-checks", "balance",
    "statistics-balance", "changes-all", "statistics", "speed-test", "settings",
  ];

  assert.deepEqual(actual, expected);
  assert.match(panel, /data-section="new"[\s\S]*?>Новый заказ<\/span>/);
  assert.match(panel, /data-section="statistics"[\s\S]*?>Статистика входов<\/span>/);
  assert.match(nav, /statistics: "Статистика входов"/);
  assert.match(boot, /statistics: "Статистика входов"/);
});
