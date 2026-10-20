import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("orders Excel action is below the table and absent from the dropdown", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const ordersSection = html.match(/<section id="section-all"[\s\S]*?<\/section>/)?.[0] || "";

  assert.doesNotMatch(html, /data-section="orders-excel"/);
  assert.match(ordersSection, /id="ordersTable"[\s\S]*id="ordersExportExcelBtn"/);
  assert.match(ordersSection, /id="ordersExportExcelBtn"[^>]*hidden[^>]*>Выгрузить в Excel<\/button>/);
});

test("only admin and user can export orders", async () => {
  const { state } = await import("../js/state.js");
  const { canAccessSection, canExportOrdersToExcel } = await import("../js/roles.js");

  for (const role of ["admin", "user"]) {
    state.currentRole = role;
    assert.equal(canExportOrdersToExcel(), true);
    assert.equal(canAccessSection("orders-excel"), true);
  }
  for (const role of ["user_lite", "user_shop"]) {
    state.currentRole = role;
    assert.equal(canExportOrdersToExcel(), false);
    assert.equal(canAccessSection("orders-excel"), false);
  }
});

test("the button uses the existing filtered export", async () => {
  const [ui, exporter] = await Promise.all([
    readFile(new URL("../js/ui.js", import.meta.url), "utf8"),
    readFile(new URL("../js/ordersExcelExport.js", import.meta.url), "utf8"),
  ]);

  assert.match(ui, /ordersExportExcelBtn/);
  assert.match(ui, /canExportOrdersToExcel\(\)/);
  assert.match(ui, /exportOrdersToExcel\(\)/);
  assert.match(exporter, /const orders = getFilteredOrders\(\)/);
});
