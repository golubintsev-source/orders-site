/** In-flight reads only: no result cache, retries, or mutation interception. */
export const READ_TIMEOUT_MS = 15_000;

export function readAbortError() {
  return Object.assign(new Error("Загрузка отменена"), { name: "AbortError", code: "ABORTED" });
}

export function createReadFetch(fetchImpl, { timeoutMs = READ_TIMEOUT_MS, baseUrl } = {}) {
  const pending = new Map();
  let epoch = 0;
  return function readFetch(input, init = {}) {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const method = (init.method || input.method || "GET").toUpperCase();
    const base = new URL(baseUrl);
    const rest = url.origin === base.origin && url.pathname.startsWith(`${base.pathname.replace(/\/$/, "")}/rest/v1/`);
    const read = rest && ["GET", "HEAD"].includes(method) && !url.pathname.includes("/rpc/");
    if (!read) {
      // A read started after a mutation must not join a pre-mutation snapshot.
      if (!rest) return fetchImpl(input, init);
      epoch += 1;
      return Promise.resolve(fetchImpl(input, init)).finally(() => { epoch += 1; });
    }
    const request = new Request(input, init);
    const signal = init.signal || (typeof Request !== "undefined" && input instanceof Request ? input.signal : null);
    if (signal?.aborted) return Promise.reject(readAbortError());
    // Include auth, schema, range/count, Prefer and every other header. Never log this key.
    const key = JSON.stringify([epoch, request.url, request.method, [...request.headers].sort(),
      request.credentials, request.cache, request.mode, request.redirect]);
    let entry = pending.get(key);
    if (!entry) {
      entry = { controller: new AbortController(), users: new Set() };
      pending.set(key, entry);
      // Read the body under the same deadline, not just response headers.
      entry.promise = Promise.resolve().then(async () => {
        const response = await fetchImpl(request, { signal: entry.controller.signal });
        const body = request.method === "HEAD" || [204, 205, 304].includes(response.status)
          ? null : await response.arrayBuffer();
        return { body, status: response.status, statusText: response.statusText, headers: response.headers };
      }).finally(() => { if (pending.get(key) === entry) pending.delete(key); });
    }
    return new Promise((resolve, reject) => {
      const user = {};
      entry.users.add(user);
      let done = false;
      const finish = (error, response) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        entry.users.delete(user);
        if (!entry.users.size) {
          if (pending.get(key) === entry) pending.delete(key);
          entry.controller.abort();
        }
        if (error) reject(error); else resolve(response);
      };
      const abort = () => finish(readAbortError());
      const timer = setTimeout(() => finish(Object.assign(new Error("Превышено время ожидания чтения"),
        { name: "TimeoutError", code: "READ_TIMEOUT" })), timeoutMs);
      signal?.addEventListener("abort", abort, { once: true });
      entry.promise.then((result) => {
        if (!done) finish(null, new Response(result.body, result));
      }, (error) => finish(error));
    });
  };
}

const scopes = new Map();
/** A new load supersedes the old load of this view, including its pagination. */
export function beginReadScope(key) {
  cancelReadScope(key);
  const controller = new AbortController();
  const scope = { signal: controller.signal, current: () => !controller.signal.aborted,
    cancel: () => controller.abort() };
  scopes.set(key, scope);
  return scope;
}
export function cancelReadScope(key) {
  scopes.get(key)?.cancel();
  scopes.delete(key);
}
export function cancelSectionReads(id) {
  const keys = {
    all: ["orders"], calculations: ["calculations"], messages: ["dialog", "message-poll", "orders"],
    "tasks-all": ["tasks-all"], "order-tasks": ["order-tasks"],
    "route-sheet": ["orders"], "manager-salary": ["orders", "manager-salary"], debts: ["orders"],
  };
  for (const key of keys[id] || [id]) cancelReadScope(key);
}
