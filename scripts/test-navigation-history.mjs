import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../js/navigation-history.js", import.meta.url), "utf8");

async function harness() {
  const frames = [];
  const events = new Map();
  const storage = new Map();
  const section = {
    id: "section-calculations",
    classList: { contains: () => true },
    scrollTop: 0,
    scrollLeft: 0,
    querySelectorAll: () => [],
    querySelector: (selector) => selector.includes('"32"') ? row : null,
  };
  const location = new URL("https://example.test/calculations");
  let active = section;
  let rowPosition = 320;
  const window = {
    scrollY: 0, scrollX: 0,
    scrollTo(x, y) { this.scrollY = y; },
    scrollBy(x, y) { this.scrollY += y; },
    addEventListener: (type, listener) => events.set(type, listener),
  };
  const scroller = { scrollTop: 0 };
  const row = {
    parentElement: scroller,
    getBoundingClientRect: () => ({ top: rowPosition - window.scrollY }),
  };
  const backButton = {
    addEventListener: (_, listener) => events.set("back", listener),
  };
  const history = {
    state: null, length: 2,
    replaceState(state) { this.state = state; },
    back() { events.get("navigate")(); },
  };
  const document = {
    scrollingElement: scroller,
    querySelector: () => active,
    getElementById: (id) => ({ navigationBackBtn: backButton, [section.id]: section })[id],
    addEventListener: (type, listener) => events.set(type, listener),
  };
  const context = vm.createContext({
    history, location, document, window,
    CSS: { escape: (value) => value },
    sessionStorage: { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    requestAnimationFrame: (fn) => frames.push(fn),
    setTimeout, clearTimeout,
  });
  const mod = new vm.SourceTextModule(source, { context });
  await mod.link(() => {});
  await mod.evaluate();
  const nav = mod.namespace;
  nav.initNavigationHistory({ capture: () => null });
  return {
    nav, window, history, events, location,
    setRowPosition: (position) => { rowPosition = position; },
    setActive: (section) => { active = section; },
    flushFrames: () => { while (frames.length) frames.shift()(); },
  };
}

test("header Back restores the captured transaction after rows are inserted above it", async () => {
  const h = await harness();
  h.window.scrollY = 250;
  const originalEntry = h.history.state;
  h.events.get("click")({ defaultPrevented: true });
  h.nav.captureNavigationState({ calculationId: "32", top: 70 });

  h.location.pathname = "/new";
  h.location.search = "?edit_order_id=42";
  h.history.state = null;
  h.setActive({ id: "section-new", querySelectorAll: () => [] });
  h.window.scrollY = 0;
  let pending;
  h.events.set("navigate", () => {
    h.location.pathname = "/calculations";
    h.location.search = "";
    h.history.state = originalEntry;
    const generation = h.nav.beginNavigationRestore();
    const snapshot = h.nav.readNavigationState();
    assert.equal(snapshot.y, 250);
    h.setRowPosition(480);
    pending = h.nav.restoreNavigationScroll(snapshot, generation);
  });
  h.events.get("back")();
  h.flushFrames();
  await pending;
  assert.equal(h.window.scrollY, 410);
});

test("pageshow restores a cached document and unlocks subsequent captures", async () => {
  const h = await harness();
  h.window.scrollY = 250;
  h.nav.prepareNavigationDeparture();
  h.window.scrollY = 0;
  h.events.get("pagehide")();
  h.events.get("pageshow")({ persisted: true });
  h.flushFrames();
  await Promise.resolve();
  assert.equal(h.window.scrollY, 250);
  h.window.scrollY = 200;
  assert.equal(h.nav.captureNavigationState().y, 200);
});
