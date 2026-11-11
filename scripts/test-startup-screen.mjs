import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../js/startup-screen.js", import.meta.url), "utf8");
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function harness({ online = true, ping = async () => ({ type: "opaque", ok: false }), css = true,
  reducedMotion = false, play = async () => {} } = {}) {
  let now = 0, next = 0, reloads = 0;
  const timers = new Map(), listeners = new Map(), probes = [];
  const element = (id) => ({ hidden: ["startupTitle", "startupDescription", "startupRetry"].includes(id), textContent: "",
    inert: id === "appContainer", sheet: id === "appStyles" && css ? {} : null,
    attrs: new Map(), events: new Map(),
    hasAttribute(name) { return this.attrs.has(name); },
    addEventListener(name, fn) { this.events.set(name, fn); },
    setAttribute(name, value) { this.attrs.set(name, value); },
    removeAttribute(name) { this.attrs.delete(name); },
  });
  const elements = Object.fromEntries(["startupScreen", "startupTitle", "startupDescription", "startupPicture", "startupPhrase",
    "startupRetry", "startupProgress", "startupMotion", "appContainer", "appStyles"].map((id) => [id, element(id)]));
  const motion = elements.startupMotion;
  motion.dataset = { src: "/images/factory-loading-3d.mp4" };
  motion.classList = new Set();
  motion.classList.remove = motion.classList.delete;
  motion.play = play;
  motion.load = () => {};
  Object.defineProperty(motion, "src", {
    get: () => motion.attrs.get("src"),
    set: (value) => motion.setAttribute("src", value),
  });
  const root = element("html"); root.setAttribute("data-startup", "loading");
  const schedule = (fn, ms, interval = false) => { const id = ++next; timers.set(id, { fn, at: now + ms, ms, interval }); return id; };
  const context = vm.createContext({ URL, Headers, AbortController, Event, Math, Date: { now: () => now },
    setTimeout: (fn, ms) => schedule(fn, ms), setInterval: (fn, ms) => schedule(fn, ms, true),
    clearTimeout: (id) => timers.delete(id), clearInterval: (id) => timers.delete(id),
    navigator: { onLine: online },
    document: { documentElement: root, getElementById: (id) => elements[id] },
    fetch: async (...args) => { probes.push(args); return ping(...args); },
    window: { location: { reload: () => reloads++ },
      matchMedia: () => ({ matches: !reducedMotion }),
      addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: (name) => listeners.delete(name), dispatchEvent() {},
    },
  });
  vm.runInContext(source, context);
  return { api: context.window.__appStartup, elements, root, probes, timers, listeners,
    reloads: () => reloads,
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const entry = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        const [id, timer] = entry; now = timer.at;
        if (timer.interval) timer.at += timer.ms; else timers.delete(id);
        timer.fn(); await tick();
      }
      now = end; await tick();
    },
  };
}
const read = (h, path, response = { ok: true }, init) => h.api.trackRead(`https://db.example/rest/v1/${path}`, init,
  async () => { if (response instanceof Error) throw response; return response; });

test("a quote appears immediately and rotates every five seconds; readiness clears all timers", async () => {
  const h = harness();
  const first = h.elements.startupPhrase.textContent;
  assert.ok(first); assert.equal(h.elements.startupPhrase.hidden, false);
  assert.equal(h.elements.startupTitle.hidden, true);
  assert.equal(h.elements.startupDescription.hidden, true);
  await h.advance(4999); assert.equal(h.elements.startupPhrase.textContent, first);
  await h.advance(1); assert.notEqual(h.elements.startupPhrase.textContent, first);
  assert.equal(await h.api.complete(), true);
  assert.equal(h.elements.startupScreen.hidden, true);
  assert.equal(h.elements.appContainer.inert, false);
  assert.equal(h.root.attrs.has("data-startup"), false);
  assert.equal(h.timers.size, 0); assert.equal(h.probes.length, 0);
});

test("startup motion is optional and releases its source on readiness or connection failure", async () => {
  const h = harness({ play: () => new Promise(() => {}) });
  const motion = h.elements.startupMotion;
  assert.equal(motion.src, motion.dataset.src);
  assert.equal(motion.classList.has("is-playing"), false);
  motion.events.get("playing")();
  assert.equal(motion.classList.has("is-playing"), true);
  assert.equal(await h.api.complete(), true);
  assert.equal(motion.src, undefined);
  assert.equal(motion.classList.has("is-playing"), false);

  const failed = harness();
  await failed.api.fail();
  assert.equal(failed.elements.startupMotion.src, undefined);
  assert.equal(failed.elements.startupPicture.src, "/img/startup/worker-data-error.webp");
});

test("reduced motion skips the video and blocked autoplay leaves the loading screen functional", async () => {
  const reduced = harness({ reducedMotion: true });
  assert.equal(reduced.elements.startupMotion.src, undefined);

  const blocked = harness({ play: async () => { throw new Error("Autoplay blocked"); } });
  await tick();
  assert.equal(blocked.elements.startupMotion.src, undefined);
  assert.equal(blocked.root.attrs.get("data-startup"), "loading");
  assert.equal(await blocked.api.complete(), true);
});

test("a swallowed required read error never reveals the empty app; ya.ru opaque response means online", async () => {
  const h = harness(); h.api.expectSection("all");
  await read(h, "orders?select=id", { ok: false });
  assert.equal(await h.api.complete(), false); await tick();
  assert.equal(h.root.attrs.get("data-startup"), "data-error");
  assert.equal(h.elements.startupScreen.hidden, false);
  assert.equal(h.elements.startupRetry.hidden, false);
  assert.equal(h.elements.startupTitle.hidden, false);
  assert.equal(h.elements.startupDescription.hidden, false);
  assert.equal(h.probes[0][1].mode, "no-cors");
  assert.equal(h.probes[0][1].cache, "no-store");
  assert.equal(h.probes[0][1].credentials, "omit");
  assert.equal(new URL(h.probes[0][0]).origin, "https://ya.ru");
});

test("network failure with failed ya.ru probe shows the offline picture and one retry reload", async () => {
  const h = harness({ ping: async () => { throw new TypeError("Failed to fetch"); } });
  h.api.expectSection("all");
  await assert.rejects(read(h, "orders?select=id", new TypeError("Failed to fetch")));
  await h.api.complete(); await tick();
  assert.equal(h.root.attrs.get("data-startup"), "offline");
  assert.equal(h.elements.startupPicture.src, "/img/startup/worker-offline.webp");
  h.elements.startupRetry.events.get("click")(); h.elements.startupRetry.events.get("click")();
  assert.equal(h.reloads(), 1);
});

test("offline at startup and a probe ignoring abort still finish within the deadline", async () => {
  const h = harness({ online: false, ping: () => new Promise(() => {}) });
  await h.advance(4000);
  assert.equal(h.root.attrs.get("data-startup"), "offline");
  assert.equal(h.probes[0][1].signal.aborted, true);
  assert.equal(h.timers.size, 0);
});

test("a stalled module triggers connectivity diagnosis after thirty seconds", async () => {
  const h = harness(); await h.advance(30000);
  assert.equal(h.root.attrs.get("data-startup"), "data-error");
});

test("successful SELECT fallback recovers its failed query, but cannot conceal a failed page", async () => {
  const h = harness(); h.api.expectSection("all");
  await read(h, "orders?select=id,legacy&offset=0", { ok: false });
  await read(h, "orders?select=*&offset=0");
  assert.equal(await h.api.complete(), true);
  const paged = harness(); paged.api.expectSection("all");
  await read(paged, "orders?select=id&offset=1000", { ok: false });
  await read(paged, "orders?select=id&offset=0");
  assert.equal(await paged.api.complete(), false);
});

test("range-header pages are independent and optional reads, HEAD counts and writes never block startup", async () => {
  const h = harness(); h.api.expectSection("all");
  await read(h, "orders?select=id", { ok: false }, { headers: { range: "1000-1999" } });
  await read(h, "orders?select=id", { ok: true }, { headers: { range: "0-999" } });
  assert.equal(await h.api.complete(), false);
  const optional = harness(); optional.api.expectSection("all");
  for (const [path, init] of [["order_files", {}], ["profiles?select=id,email", {}], ["orders", { method: "HEAD" }],
    ["orders", { method: "POST" }], ["site_access_logs", {}]]) {
    await read(optional, path, { ok: false }, init);
  }
  assert.equal(await optional.api.complete(), true);
});

test("profile role is mandatory even when its loader falls back to a cached role", async () => {
  const h = harness(); await read(h, "profiles?select=role&id=eq.user", { ok: false });
  h.api.expectSection("calculations");
  await read(h, "calculations?select=id");
  assert.equal(await h.api.complete(), false);
});

test("a fresh server response proves online even if ya.ru is unavailable", async () => {
  const h = harness({ ping: async () => { throw new Error("ya.ru blocked"); } });
  h.api.expectSection("all"); await read(h, "orders", { ok: false });
  await h.api.complete(); await tick();
  assert.equal(h.root.attrs.get("data-startup"), "data-error");
});

test("late diagnosis cannot replace a loaded app and subsequent requests are not gated", async () => {
  let resolve;
  const h = harness({ ping: () => new Promise((r) => { resolve = r; }) });
  const pending = h.api.fail(); await tick();
  assert.equal(await h.api.complete(), true);
  resolve({ type: "opaque" }); await pending;
  assert.equal(h.elements.startupScreen.hidden, true);
  h.api.expectSection("all"); await read(h, "orders", { ok: false });
  assert.equal(await h.api.complete(), true);
});

test("readiness waits for the application CSS; resource failures offer retry", async () => {
  const h = harness({ css: false });
  let completed = false;
  const ready = h.api.complete().then((ok) => { completed = ok; });
  await tick(); assert.equal(completed, false); assert.equal(h.elements.startupScreen.hidden, false);
  h.elements.appStyles.events.get("load")(); await ready;
  assert.equal(completed, true); assert.equal(h.elements.appStyles.media, "all");
  const failed = harness({ css: false });
  failed.elements.appStyles.events.get("error")(); await tick();
  assert.equal(failed.elements.startupRetry.hidden, false);
});

test("real service worker precaches the complete startup screen and serves it offline on a deep route", async () => {
  const workerSource = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  const handlers = new Map(), cached = new Map();
  let offline = false;
  const cacheKey = (input) => typeof input === "string" ? input : new URL(input.url).pathname;
  const cache = {
    put: async (input, response) => cached.set(cacheKey(input), response),
    match: async (input) => cached.get(cacheKey(input))?.clone(),
  };
  const context = vm.createContext({ URL, Response, console,
    caches: { open: async () => cache },
    self: { location: { origin: "https://app.example" }, skipWaiting: async () => {},
      addEventListener: (name, handler) => handlers.set(name, handler) },
    fetch: async (input) => {
      if (offline) throw new TypeError("offline");
      const path = String(input).split("?")[0];
      return new Response(readFileSync(new URL(`..${path === "/" ? "/index.html" : path}`, import.meta.url)));
    },
  });
  vm.runInContext(workerSource, context);
  let installed;
  handlers.get("install")({ waitUntil: (promise) => { installed = promise; } });
  await installed;
  for (const path of ["/js/startup-screen.js", "/img/startup/factory-animation-poster.webp", "/img/startup/worker-offline.webp", "/img/startup/worker-data-error.webp"]) {
    assert.ok(cached.get(path), `${path} must exist and be precached`);
  }
  offline = true;
  let result;
  handlers.get("fetch")({
    request: new Request("https://app.example/calculations", { headers: { accept: "text/html" } }),
    respondWith: (promise) => { result = promise; }, waitUntil() {},
  });
  const response = await result;
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /id="startupScreen"/);
  assert.match(html, /data-startup="loading"/);
  assert.match(html, /id="appContainer" inert/);
});
