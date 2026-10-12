import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createReadFetch, beginReadScope, cancelSectionReads } from "../js/read-requests.js";
import { fetchAllSupabaseRows, fetchSupabaseByIdsInChunks } from "../js/supabase-fetch.js";

const baseUrl = "https://test.supabase.co";
const url = `${baseUrl}/rest/v1/orders?select=id`;
const tick = () => new Promise(resolve => setImmediate(resolve));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function harness(timeoutMs = 1000) {
  const calls = [];
  const fetch = createReadFetch((input, init) => new Promise((resolve, reject) => {
    calls.push({ input, signal: init?.signal, resolve, reject });
  }), { baseUrl, timeoutMs });
  return { calls, fetch };
}
const reply = call => call.resolve(new Response('[{"id":1}]', { headers: { "content-type": "application/json", "content-range": "0-0/1" } }));

test("identical concurrent reads share network, have independently readable bodies, no completed cache", async () => {
  const h = harness(); const a = h.fetch(url), b = h.fetch(url);
  await tick(); assert.equal(h.calls.length, 1); reply(h.calls[0]);
  const [ar, br] = await Promise.all([a, b]);
  assert.deepEqual(await ar.json(), await br.json());
  assert.equal(ar.headers.get("content-range"), "0-0/1");
  const c = h.fetch(url); await tick(); assert.equal(h.calls.length, 2); reply(h.calls[1]); await c;
});
test("auth, schema, range, Prefer, filter, and method cannot be coalesced", async () => {
  const h = harness();
  const variants = [{}, { headers: { Authorization: "Bearer other" } }, { headers: { "Accept-Profile": "private" } },
    { headers: { Range: "1-2" } }, { headers: { Prefer: "count=exact" } }, { method: "HEAD" }];
  const ps = variants.map(v => h.fetch(url, v)); ps.push(h.fetch(url + "&id=eq.2"));
  await tick(); assert.equal(h.calls.length, ps.length); h.calls.forEach(reply); await Promise.all(ps);
});
test("cancel one subscriber without canceling another; cancel last aborts actual fetch", async () => {
  const h = harness(); const c = new AbortController(), d = new AbortController();
  const a = h.fetch(url, { signal: c.signal }), b = h.fetch(url, { signal: d.signal });
  await tick(); const check = assert.rejects(a, { name: "AbortError" }); c.abort(); await check;
  assert.equal(h.calls[0].signal.aborted, false);
  const checkB = assert.rejects(b, { name: "AbortError" }); d.abort(); await checkB;
  assert.equal(h.calls[0].signal.aborted, true);
  const fresh = h.fetch(url); await tick(); assert.equal(h.calls.length, 2); reply(h.calls[1]); await fresh;
});
test("each subscriber has its own deadline; older timeout cannot poison new consumer", async () => {
  const h = harness(100); const a = h.fetch(url); const check = assert.rejects(a, { name: "TimeoutError" });
  await pause(60); const b = h.fetch(url); await check;
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].signal.aborted, false);
  reply(h.calls[0]); assert.equal((await b).status, 200);
});
test("stalled response body is bounded, even if fetch ignores abort", async () => {
  let signal;
  const f = createReadFetch(async (_, init) => { signal = init.signal; return new Response(new ReadableStream({ start() {} })); }, { baseUrl, timeoutMs: 20 });
  await assert.rejects(f(url), { name: "TimeoutError" }); assert.equal(signal.aborted, true);
});
test("network failure is evicted and does not retry", async () => {
  const h = harness(); const a = h.fetch(url); await tick(); h.calls[0].reject(new TypeError("offline"));
  await assert.rejects(a); const b = h.fetch(url); await tick(); assert.equal(h.calls.length, 2); reply(h.calls[1]); await b;
});
test("HTTP errors preserve status and body", async () => {
  const h = harness(); const a = h.fetch(url); await tick();
  h.calls[0].resolve(new Response('{"code":"42501"}', { status: 403 }));
  const r = await a; assert.equal(r.status, 403); assert.equal((await r.json()).code, "42501");
});
test("writes, RPC, auth, storage pass through unchanged, no timeout/dedup or consumed Request body", async () => {
  const calls = []; const f = createReadFetch((...args) => { calls.push(args); return Promise.resolve(new Response(null, { status: 204 })); }, { baseUrl });
  const req = new Request(url, { method: "POST", body: '{"id":1}' });
  await f(req); assert.equal(calls[0][0], req); assert.equal(await req.text(), '{"id":1}');
  for (const path of ["/rest/v1/rpc/save_order", "/auth/v1/token", "/storage/v1/object/file"]) { await f(baseUrl+path); await f(baseUrl+path); }
  assert.equal(calls.length, 7);
});
test("a mutation splits the dedup epoch without canceling existing readers", async () => {
  const h = harness(); const a = h.fetch(url); await tick();
  const w = h.fetch(url, { method: "PATCH", body: "{}" }); reply(h.calls[1]); await w;
  const b = h.fetch(url); await tick(); assert.equal(h.calls.length, 3);
  assert.equal(h.calls[0].signal.aborted, false); reply(h.calls[0]); reply(h.calls[2]); await Promise.all([a,b]);
});
test("already aborted Request input does not start fetch", async () => {
  const h = harness(); const c = new AbortController(); c.abort();
  await assert.rejects(h.fetch(new Request(url, { signal: c.signal })), { name: "AbortError" });
  assert.equal(h.calls.length, 0);
});
test("new scope and section departure invalidate only their own reads", () => {
  const a = beginReadScope("calculations"), b = beginReadScope("statistics");
  const c = beginReadScope("calculations"); assert.equal(a.current(), false); assert.equal(b.current(), true);
  cancelSectionReads("calculations"); assert.equal(c.current(), false); assert.equal(b.current(), true);
  cancelSectionReads("statistics");
});
test("pagination/chunks stop on abort and never return partial rows as success", async () => {
  for (const chunks of [false, true]) {
    const c = new AbortController(); let calls = 0;
    const query = () => ({ range() { return this; }, abortSignal(s) { assert.equal(s, c.signal); return this; },
      then(resolve) { calls++; c.abort(); resolve({ data: [{ id: 1 }], error: null }); } });
    const r = chunks ? await fetchSupabaseByIdsInChunks(query, [1,2], { chunkSize: 1, signal: c.signal })
      : await fetchAllSupabaseRows(query, { pageSize: 1, signal: c.signal });
    assert.equal(calls, 1); assert.equal(r.data, null); assert.equal(r.error.code, "ABORTED");
  }
});
test("bundled Supabase SDK + real HTTP: dedup, abortSignal, deadline, status/count and writes", async () => {
  const { createClient } = new Function(readFileSync(new URL("../js/vendor/supabase.js", import.meta.url), "utf8") + ";return supabase;")();
  const requests = [];
  const server = createServer((req,res) => {
    requests.push(req.method + " " + req.url);
    if (req.url.includes("stalled")) return;
    setTimeout(() => { res.writeHead(200, { "Content-Type": "application/json", "Content-Range": "0-0/1" }); res.end('[{"id":1}]'); }, 25);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = createClient(base, "test-key", { db: { retry: false }, auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createReadFetch(fetch, { baseUrl: base, timeoutMs: 100 }) } });
  try {
    const [a,b] = await Promise.all([client.from("orders").select("id", { count: "exact" }), client.from("orders").select("id", { count: "exact" })]);
    assert.equal(a.error, null); assert.equal(a.count, 1); assert.deepEqual(a.data, b.data); assert.equal(requests.length, 1);
    const c = new AbortController(); const read = Promise.resolve(client.from("stalled").select().abortSignal(c.signal));
    await pause(15); c.abort(); assert.match((await read).error.message, /AbortError/);
    const timeout = await client.from("stalled").select(); assert.match(timeout.error.message, /TimeoutError/);
    await Promise.all([client.from("orders").insert({ id: 2 }), client.from("orders").insert({ id: 3 })]);
    assert.equal(requests.filter(x => x.startsWith("POST")).length, 2);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
