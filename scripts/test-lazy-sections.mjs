import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { createSectionLifecycle } from "../js/section-lifecycle.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("duplicate pending entry is shared; import/init once, load on re-entry", async () => {
  let imports = 0, inits = 0, loads = 0;
  const gate = deferred();
  const router = createSectionLifecycle({ a: async () => {
    imports++; await gate.promise;
    return { init: () => inits++, load: () => loads++ };
  } });
  const first = router.enter("a");
  assert.equal(first, router.enter("a"));
  gate.resolve(); await first;
  await router.enter("a");
  assert.deepEqual([imports, inits, loads], [1, 1, 2]);
});

test("late import / preparation of a closed section cannot start its data load", async () => {
  for (const phase of ["import", "prepare"]) {
    const gate = deferred(); const calls = [];
    const router = createSectionLifecycle({
      a: async () => {
        if (phase === "import") await gate.promise;
        return { prepare: () => phase === "prepare" ? gate.promise : undefined,
          init: () => calls.push("a:init"), load: () => calls.push("a:load") };
      },
      b: async () => ({ load: () => calls.push("b:load") }),
    });
    const old = router.enter("a"); await tick();
    router.leave("a"); await router.enter("b");
    gate.resolve(); await old;
    assert.deepEqual(calls, ["b:load"]);
  }
});

test("failed imports and failed loads can be retried", async () => {
  let attempts = 0;
  const router = createSectionLifecycle({ a: async () => {
    if (++attempts === 1) throw new Error("network");
    return { load: () => { if (++attempts === 3) throw new Error("query"); } };
  } });
  await assert.rejects(router.enter("a"));
  await assert.rejects(router.enter("a"));
  await router.enter("a");
});

test("leaving an unopened section does not import it; loaded section gets cleanup", async () => {
  let imports = 0, leaves = 0;
  const router = createSectionLifecycle({ a: async () => {
    imports++; return { leave: () => leaves++ };
  } });
  router.leave("a"); assert.equal(imports, 0);
  await router.enter("a"); router.leave("a"); assert.equal(leaves, 1);
});

test("different order/chat keys are not coalesced while an import is pending", async () => {
  const gate = deferred(); const keys = [];
  const router = createSectionLifecycle({ a: async () => {
    await gate.promise; return { load: (opts) => keys.push(opts.loadKey) };
  } });
  const old = router.enter("a", { loadKey: "first" });
  await tick();
  const latest = router.enter("a", { loadKey: "second" });
  assert.notEqual(old, latest);
  gate.resolve(); await Promise.all([old, latest]);
  assert.deepEqual(keys, ["second"]);
});

const sectionExports = ["initAllSalariesSection", "loadAllSalaries", "bindExcessSection", "loadExcesses",
  "initCalculationsSection", "onMessagesSectionEnter", "stopMessagesPolling", "onVoiceSectionEnter", "onVoiceSectionLeave",
  "initOrderTasksSection", "loadAllTasks", "loadOrderTasks", "ensureOrderTaskExecutorsLoaded", "initAllChangesSection", "loadAllChanges",
  "loadBalance", "loadManagerSalary", "initRouteSheetSection", "loadRouteSheet", "bumpRouteDeliveryMapGeneration",
  "initDebtsSection", "loadDebts", "initStatisticsSection", "loadStatistics", "initStatisticsBalanceSection", "loadStatisticsBalance",
  "bindSettingsUI", "loadSettings", "applySettingsAdminBlocksVisibility", "initPushNotificationsSection",
  "initLoginLinksSection", "loadLoginLinksSection", "onSpeedTestSectionEnter"];

async function registryHarness() {
  const imports = [], calls = [];
  const context = vm.createContext({ window: {}, document: {} });
  const state = { currentUser: { id: "user" }, viewingOrderId: null, editingOrderId: null };
  const orders = { paintOrdersFromLocalStorageIfAny: () => calls.push("paintOrders"),
    loadOrders: () => calls.push("ordersData"), resetFormMode: () => calls.push("resetForm") };
  const synthetic = async (values) => {
    const m = new vm.SyntheticModule(Object.keys(values), function () {
      for (const [name, value] of Object.entries(values)) this.setExport(name, value);
    }, { context });
    await m.link(() => {}); await m.evaluate(); return m;
  };
  const mod = new vm.SourceTextModule(read("js/section-loader.js"), { context,
    importModuleDynamically: async (path) => {
      imports.push(path);
      if (path === "./orders-runtime.js") return synthetic({
        ensureOrdersUI: async () => orders,
        ensureOrderFormReady: async () => { calls.push("formReady"); return orders; },
        ensureOrdersData: async () => calls.push("ordersData"),
        ensureOrderSettings: async () => calls.push("settingsData"),
      });
      if (path === "./order-task-links.js") return synthetic({ refreshActiveTaskOrderRefs() {} });
      return synthetic(Object.fromEntries(sectionExports.map((name) => [name, () => calls.push(name)])));
    },
  });
  await mod.link(async (path) => {
    if (path === "./state.js") return synthetic({ state });
    if (path === "./roles.js") return synthetic({ isAdmin: () => true });
    return new vm.SourceTextModule(read("js/section-lifecycle.js"), { context });
  });
  await mod.evaluate();
  return { api: mod.namespace, imports, calls };
}

for (const [section, module, load] of [
  ["messages", "messages", "onMessagesSectionEnter"], ["calculations", "calculations", "initCalculationsSection"],
  ["all-salaries", "all-salaries", "loadAllSalaries"], ["tasks-all", "tasks", "loadAllTasks"],
  ["order-tasks", "tasks", "loadOrderTasks"], ["changes-all", "all-changes", "loadAllChanges"],
  ["statistics", "statistics", "loadStatistics"], ["statistics-balance", "statistics-balance", "loadStatisticsBalance"],
  ["speed-test", "speed-test", "onSpeedTestSectionEnter"],
]) test(`${section}: only its module, no orders archive or settings`, async () => {
  const h = await registryHarness();
  assert.equal(h.imports.length, 0);
  await h.api.enterSection(section);
  assert.deepEqual(h.imports, [`./${module}.js`]);
  assert.ok(h.calls.includes(load));
  assert.ok(!h.calls.includes("ordersData"));
  assert.ok(!h.calls.includes("settingsData"));
});

test("settings loads login links only on demand; new order needs form but not archive", async () => {
  const h = await registryHarness();
  await h.api.enterSection("settings");
  assert.ok(h.calls.includes("loadLoginLinksSection"));
  assert.ok(!h.calls.includes("ordersData"));
  const form = await registryHarness(); await form.api.enterSection("new");
  assert.deepEqual(form.calls, ["formReady", "resetForm"]);
});

test("order-backed reports wait for their data dependency before rendering", async () => {
  for (const [section, load] of [["debts", "loadDebts"], ["manager-salary", "loadManagerSalary"], ["route-sheet", "loadRouteSheet"]]) {
    const h = await registryHarness(); await h.api.enterSection(section);
    assert.ok(h.calls.indexOf("ordersData") < h.calls.indexOf(load));
    assert.equal(h.calls.filter((name) => name === load).length, 1);
  }
});

function staticGraph(entry, seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const source = read(entry);
  for (const match of source.matchAll(/(?:import|export)\s+(?:[^;]*?\s+from\s*)?["'](\.\/[^"']+)["']/g)) {
    const path = "js/" + match[1].slice(2).split("?")[0];
    staticGraph(path, seen);
  }
  return seen;
}

test("shell and chat static graphs exclude order UI and other screens", () => {
  for (const entry of ["js/main.js", "js/messages.js", "js/nav-status.js", "js/all-salaries.js"]) {
    const graph = staticGraph(entry);
    for (const path of ["js/orders.js", "js/ui.js", "js/files.js", "js/settings.js", "js/calculations.js", "js/voice.js", "js/tasks.js", "js/balance.js"]) {
      assert.ok(!graph.has(path), `${entry} unexpectedly imports ${path}`);
    }
  }
});

test("HTML and service worker do not eagerly preload closed screens", () => {
  const html = read("index.html"), sw = read("sw.js");
  const precache = sw.slice(sw.indexOf("const PRECACHE_URLS"), sw.indexOf("self.addEventListener"));
  for (const name of ["orders", "ui", "files", "messages", "manager-salary", "debts", "all-salaries"]) {
    assert.ok(!precache.includes(`/js/${name}.js`));
    assert.ok(!html.includes(`rel="modulepreload" href="./js/${name}.js"`));
  }
  assert.ok(!html.includes("bootManagerSalaryPage"));
  assert.ok(!read("js/main.js").includes("initSecondarySections"));
});

async function startupHarness({ route, savedApp = null, orderId = null, allowed = true }) {
  const calls = [], dynamicImports = [];
  let active = route;
  const user = { id: "user", email: "test@example.invalid" };
  const state = { currentUser: user };
  const context = vm.createContext({ console, document: {
    documentElement: { hasAttribute: () => true },
    getElementById: () => null, addEventListener() {},
  }, window: { location: { replace: (url) => calls.push(["redirect", url]) }, addEventListener() {} },
  sessionStorage: { getItem: () => null, removeItem() {} } });
  const values = {
    state, checkAuth: async () => user, loadProfile: async () => calls.push(["profile"]),
    canAccessSection: (id) => allowed || id === "all", getOrderIdFromUrl: () => orderId,
    getRouteSectionFromUrl: () => route, getCurrentSectionId: () => active,
    switchSection: async (id) => { active = id; calls.push(["section", id]); },
    readSavedPlaceForCurrentPage: () => savedApp ? { app: savedApp } : null,
    consumeSkipUserPlaceResume: () => false, captureHref: () => "/" + route,
    readUserPlace: () => null, shouldRedirectToSavedPlace: () => false,
    getLoginKeyFromUrl: () => null,
  };
  const make = async (exports) => {
    const m = new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context }); await m.link(() => {}); await m.evaluate(); return m;
  };
  const source = read("js/main.js");
  const module = new vm.SourceTextModule(source.replace("void init().catch(reportError);", "export { init };"), {
    context, importModuleDynamically: async (path) => {
      dynamicImports.push(path);
      if (path === "./orders-runtime.js") return make({ ensureOrdersUI: async () => ({
        viewOrder: async (id) => calls.push(["viewOrder", id]), editOrder: async (id) => calls.push(["editOrder", id]),
      }) });
      return make({ initNavStatus() {}, initPushNotifications() {} });
    },
  });
  await module.link(async (path) => {
    const match = [...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g)].find((m) => m[2] === path);
    const names = match[1].split(",").map((s) => s.trim()).filter(Boolean);
    return make(Object.fromEntries(names.map((name) => [name, values[name] ?? (() => {})])));
  });
  await module.evaluate(); await module.namespace.init(); await tick();
  return { calls, dynamicImports };
}

test("real startup script: cold chat and calculations never start orders or settings", async () => {
  for (const route of ["messages", "calculations"]) {
    const h = await startupHarness({ route });
    assert.deepEqual(h.calls.filter(([name]) => name === "section"), [["section", route]]);
    assert.deepEqual(h.dynamicImports.sort(), ["./nav-status.js", "./push-notifications.js"]);
  }
});

test("real startup script resolves saved route before loading, and order URL takes priority", async () => {
  const saved = await startupHarness({ route: "all", savedApp: { sectionId: "messages" } });
  assert.deepEqual(saved.calls.filter(([name]) => name === "section"), [["section", "messages"]]);
  const order = await startupHarness({ route: "new", orderId: 42, savedApp: { sectionId: "messages" } });
  assert.ok(order.calls.some(([name, id]) => name === "viewOrder" && id === 42));
  assert.ok(!order.calls.some(([name]) => name === "section"));
  const denied = await startupHarness({ route: "debts", allowed: false });
  assert.deepEqual(denied.calls.filter(([name]) => name === "section"), [["section", "all"]]);
});

test("header status uses scoped counts, not message histories, and yields to chat module", async () => {
  const queries = [], badges = [];
  const window = {};
  const context = vm.createContext({ console, window, document: { getElementById: () => null } });
  const client = { from(table) {
    const query = { table, filters: [] };
    const builder = {
      select(columns, options) { query.columns = columns; query.options = options; return this; },
      eq(...args) { query.filters.push(["eq", ...args]); return this; },
      neq(...args) { query.filters.push(["neq", ...args]); return this; },
      is(...args) { query.filters.push(["is", ...args]); return this; },
      gt(...args) { query.filters.push(["gt", ...args]); return this; },
      contains(...args) { query.filters.push(["contains", ...args]); return this; },
      order() { return this; }, maybeSingle() { return this; },
      then(resolve) {
        queries.push(query);
        return Promise.resolve(table === "group_chats" ? { data: [{ id: "g1" }] }
          : table === "group_chat_reads" ? { data: { last_read_at: "2026-10-01" } }
          : { count: 2 }).then(resolve);
      },
    }; return builder;
  } };
  const exports = { supabaseClient: client, state: { currentUser: { id: "u1" } },
    refreshMyTasksNavBadge() {}, setPushBadgeCount: async (n) => badges.push(n),
    fetchAllSupabaseRows: async (query) => query(), conversationPeerFromPushData() {} };
  const source = read("js/nav-status.js");
  const m = new vm.SourceTextModule(source, { context });
  await m.link(async (path) => {
    const match = [...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g)].find((item) => item[2] === path);
    const names = match[1].split(",").map((s) => s.trim());
    return new vm.SyntheticModule(names, function () { for (const name of names) this.setExport(name, exports[name]); }, { context });
  });
  await m.evaluate(); await m.namespace.refreshHeaderMessages();
  assert.deepEqual(badges, [4]);
  assert.equal(queries.length, 4);
  for (const query of queries.filter((q) => q.table.endsWith("messages"))) {
    assert.equal(query.columns, "id"); assert.equal(query.options.head, true);
    assert.equal(query.options.count, "exact");
  }
  assert.ok(queries[0].filters.some((f) => f[1] === "recipient_id" && f[2] === "u1"));
  assert.ok(queries[3].filters.some((f) => f[0] === "gt" && f[2] === "2026-10-01"));
  window.__messagesStatusReady = true;
  await m.namespace.refreshHeaderMessages(); assert.equal(queries.length, 4);
});
