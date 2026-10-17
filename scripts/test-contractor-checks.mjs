import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class FakeClassList {
  values = new Set();
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}

class FakeElement extends EventTarget {
  constructor() {
    super();
    this.classList = new FakeClassList();
    this.innerHTML = "";
    this.open = false;
    this.scrollTop = -1;
  }

  click() { this.dispatchEvent(new Event("click")); }
  focus() { document.activeElement = this; }
}

class FakeDialog extends FakeElement {
  showModal() { this.open = true; }
  close() {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  }
}

test("contractor report renders without the original prompt and opens full-screen dialog", async () => {
  const openBtn = new FakeElement();
  const closeBtn = new FakeElement();
  const dialog = new FakeDialog();
  const body = new FakeElement();
  const elements = new Map([
    ["openUnionPolymerReport", openBtn],
    ["contractorReportCloseBtn", closeBtn],
    ["contractorReportDialog", dialog],
    ["contractorReportBody", body],
  ]);

  globalThis.HTMLElement = FakeElement;
  globalThis.document = {
    activeElement: openBtn,
    body: new FakeElement(),
    getElementById(id) { return elements.get(id) ?? null; },
  };

  const module = await import(`../js/contractor-checks.js?test=${Date.now()}`);
  module.initContractorChecksSection();

  assert.match(body.innerHTML, /Проверка деловой репутации ООО «Юнион Полимер Технолоджи»/);
  assert.match(body.innerHTML, /17 октября 2026 года/);
  assert.doesNotMatch(body.innerHTML, /У меня компания малый бизнес/);
  assert.equal((body.innerHTML.match(/<section>/g) || []).length, 9);
  assert.equal((body.innerHTML.match(/<table>/g) || []).length, 2);

  openBtn.click();
  assert.equal(dialog.open, true);
  assert.equal(body.scrollTop, 0);
  assert.equal(document.body.classList.contains("contractor-report-open"), true);
  assert.equal(document.activeElement, closeBtn);

  closeBtn.click();
  assert.equal(dialog.open, false);
  assert.equal(document.body.classList.contains("contractor-report-open"), false);
  assert.equal(document.activeElement, openBtn);
});

test("contractor checks is wired into routing, navigation and the app shell", async () => {
  const [routes, nav, boot, loader, vercel, worker, html] = await Promise.all([
    readFile(new URL("../js/app-routes.js", import.meta.url), "utf8"),
    readFile(new URL("../js/section-nav.js", import.meta.url), "utf8"),
    readFile(new URL("../js/boot-route.js", import.meta.url), "utf8"),
    readFile(new URL("../js/section-loader.js", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
    readFile(new URL("../sw.js", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
  ]);

  for (const source of [routes, nav, boot, loader, vercel, worker, html]) {
    assert.match(source, /contractor-checks/);
  }
  assert.match(html, /<th>Дата проверки<\/th>/);
  assert.match(html, /<th>Название компании<\/th>/);
  assert.match(html, /ООО «Юнион Полимер Технолоджи»/);
});
