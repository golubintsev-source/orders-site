import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const source = read("js/calculations.js");
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function harness() {
  const queries = [], saved = [], rendered = [], messages = [];
  let authCalls = 0, bindings = 0;
  const context = vm.createContext({ console, document: {
    querySelector: () => ({}), getElementById: () => null,
  }, recordRows: (rows) => rendered.push(rows), recordMessage: (...args) => messages.push(args),
  recordBinding: () => bindings++ });
  const client = { from(table) {
    const filters = {};
    const query = {
      select() { return this; }, is() { return this; }, order() { return this; },
      in(column, ids) { filters.ids = ids; return this; },
      gte(column, value) { filters.from = value; return this; },
      lte(column, value) { filters.to = value; return this; },
      range(from, to) { return new Promise((resolve) => queries.push({ table, filters, from, to, resolve })); },
      then(resolve, reject) { return this.range().then(resolve, reject); },
    };
    return query;
  } };
  const values = {
    supabaseClient: client, state: { currentUser: { id: "test-user" } },
    checkAuth: async () => { authCalls++; return { id: "test-user" }; },
    raceWithTimeout: (promise) => promise,
    mergeCalculationRows: (rows) => rows,
    readSnapshot: () => ({ calculations: [{ id: -1 }], orders: [] }),
    persistCalculationsSnapshot: (rows) => saved.push(rows),
    isBrowserOffline: () => false, isOfflineDataMode: () => false,
  };
  const mod = new vm.SourceTextModule(source + `
    renderCalculationsTableFromCache = () => recordRows(calculationsRowsCache);
    setMessage = (...args) => recordMessage(...args);
    setupCalculationsForm = () => recordBinding();
    export const testState = {
      period(from, to) { calcColumnFilters.timeFrom = from; calcColumnFilters.timeTo = to; },
      rows: () => calculationsRowsCache,
      addresses: () => calcOrderAddressById,
    };
  `, { context });
  await mod.link(async (specifier) => {
    if (specifier === "./supabase-fetch.js") return new vm.SourceTextModule(read("js/supabase-fetch.js"), { context });
    const imports = [...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g)];
    const names = imports.find((match) => match[2] === specifier)[1].split(",").map((name) => name.trim()).filter(Boolean);
    return new vm.SyntheticModule(names, function () {
      for (const name of names) this.setExport(name, values[name] ?? (() => {}));
    }, { context });
  });
  await mod.evaluate();
  return { api: mod.namespace, queries, saved, rendered, messages,
    authCalls: () => authCalls, bindings: () => bindings };
}

test("import is inert; section initializes filters before one shared request", async () => {
  const h = await harness();
  assert.equal(h.authCalls(), 0);
  assert.equal(h.queries.length, 0);
  const first = h.api.initCalculationsSection();
  const second = h.api.initCalculationsSection();
  await tick();
  assert.equal(h.bindings(), 1);
  assert.equal(h.queries.length, 1);
  assert.ok(h.queries[0].filters.from);
  assert.ok(h.queries[0].filters.to);
  assert.equal(new Date(h.queries[0].filters.from).getDate(), new Date().getDate());
  h.queries[0].resolve({ data: [{ id: 1 }], error: null });
  await Promise.all([first, second]);
  assert.equal(h.rendered.length, 1);
});

test("same-period calls share promise; explicitly cleared dates stay cleared", async () => {
  const h = await harness();
  h.api.initCalculationsDateRangeDefaults();
  h.api.testState.period("", "");
  const first = h.api.loadCalculations();
  assert.equal(first, h.api.loadCalculations());
  await tick();
  assert.deepEqual(h.queries[0].filters, {});
  h.queries[0].resolve({ data: [], error: null });
  await first;
});

for (const staleError of [false, true]) {
  test(`new period wins over late ${staleError ? "error" : "rows"}`, async () => {
    const h = await harness();
    const old = h.api.loadCalculations();
    await tick();
    h.api.testState.period("2026-01-01T00:00", "2026-01-02T23:59");
    const latest = h.api.loadCalculations();
    await tick();
    h.queries[1].resolve({ data: [{ id: 2 }], error: null });
    await latest;
    h.queries[0].resolve({ data: [{ id: 1 }], error: staleError ? new Error("old") : null });
    await old;
    assert.equal(h.api.testState.rows()[0].id, 2);
    assert.equal(h.saved.length, 1);
    assert.equal(h.rendered.length, 1);
    assert.equal(h.messages.length, 1);
  });
}

test("pagination keeps captured period and stops after supersession", async () => {
  const h = await harness();
  const old = h.api.loadCalculations();
  await tick();
  const period = { ...h.queries[0].filters };
  h.api.testState.period("2026-01-01T00:00", "");
  h.queries[0].resolve({ data: Array.from({ length: 1000 }, (_, id) => ({ id })), error: null });
  await tick();
  assert.deepEqual(h.queries[1].filters, period);
  assert.equal(h.queries[1].from, 1000);
  const latest = h.api.loadCalculations();
  await tick();
  h.queries[1].resolve({ data: Array.from({ length: 1000 }, (_, id) => ({ id })), error: null });
  await old;
  assert.equal(h.queries.length, 3);
  h.queries[2].resolve({ data: [], error: null });
  await latest;
});

test("post-write refresh supersedes a pending read even for identical dates", async () => {
  const h = await harness();
  const old = h.api.loadCalculations();
  await tick();
  const latest = h.api.loadCalculations({ force: true });
  await tick();
  assert.equal(h.queries.length, 2);
  h.queries[1].resolve({ data: [{ id: 2 }], error: null });
  await latest;
  h.queries[0].resolve({ data: [{ id: 1 }], error: null });
  await old;
  assert.equal(h.api.testState.rows()[0].id, 2);
});

test("late order-address response cannot overwrite newer rows or addresses", async () => {
  const h = await harness();
  const old = h.api.loadCalculations();
  await tick();
  h.queries[0].resolve({ data: [{ id: 1, comment: "[AUTO_ORDER_DELTA] Заказ; 123; адрес" }], error: null });
  await tick();
  assert.equal(h.queries[1].table, "orders");
  const latest = h.api.loadCalculations({ force: true });
  await tick();
  h.queries[2].resolve({ data: [{ id: 2 }], error: null });
  await latest;
  h.queries[1].resolve({ data: [{ id: 123, address: "old" }], error: null });
  await old;
  assert.equal(h.api.testState.rows()[0].id, 2);
  assert.equal(h.api.testState.addresses().size, 0);
  assert.equal(h.saved.length, 1);
});

test("failed load falls back and a later call retries", async () => {
  const h = await harness();
  const first = h.api.loadCalculations();
  await tick();
  h.queries[0].resolve({ data: null, error: { message: "test failure" } });
  await first;
  assert.equal(h.api.testState.rows()[0].id, -1);
  assert.equal(h.saved.length, 0);
  const retry = h.api.loadCalculations();
  await tick();
  h.queries[1].resolve({ data: [{ id: 2 }], error: null });
  await retry;
  assert.equal(h.api.testState.rows()[0].id, 2);
});

test("standalone entry and navigation use explicit initialization; main does not preload", async () => {
  assert.match(read("calculations.html"), /src="\.\/js\/calculations-page\.js"/);
  assert.match(read("js/calculations-page.js"), /initCalculationsPage\(\)/);
  assert.match(read("js/section-nav.js"), /m\.initCalculationsSection\(\)/);
  assert.doesNotMatch(read("js/main.js"), /loadCalculations|bindCalculationsSection/);
  const h = await harness();
  const ready = h.api.initCalculationsPage();
  await tick();
  assert.equal(h.authCalls(), 1);
  assert.equal(h.queries.length, 1);
  h.queries[0].resolve({ data: [], error: null });
  await ready;
});
