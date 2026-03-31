const { createClient } = window.supabase;

export const SUPABASE_URL =
  typeof window !== "undefined" && window.__SUPABASE_URL__
    ? window.__SUPABASE_URL__
    : "https://yizwpogwabosuguakyzt.supabase.co";
export const SUPABASE_KEY =
  typeof window !== "undefined" && window.__SUPABASE_ANON_KEY__
    ? window.__SUPABASE_ANON_KEY__
    : "sb_publishable_e1pJB18UsEV-o_M43ROi9w_4mS--LrF";

/** На localhost — прямой Supabase; на проде — через /api/supabase-proxy. Принудительно: window.__SUPABASE_USE_PROXY__ */
function shouldUseDbProxy() {
  if (typeof window.__SUPABASE_USE_PROXY__ === "boolean") {
    return window.__SUPABASE_USE_PROXY__;
  }
  const h = window.location.hostname;
  if (h === "localhost" || h === "127.0.0.1") return false;
  return true;
}

function headersToObject(headers) {
  const o = {};
  if (!headers) return o;
  const h = headers instanceof Headers ? headers : new Headers(headers);
  h.forEach((v, k) => {
    o[k] = v;
  });
  return o;
}

function isBinaryUploadContentType(ct) {
  if (!ct) return false;
  const c = ct.toLowerCase();
  if (c.includes("json") || c.includes("text/plain") || c.includes("graphql")) return false;
  if (c.startsWith("image/") || c.startsWith("video/") || c.startsWith("audio/")) return true;
  if (c.includes("octet-stream")) return true;
  if (c.startsWith("multipart/")) return true;
  return false;
}

/**
 * Проксирует PostgREST, Storage и Auth через same-origin /api/supabase-proxy (сервер → Supabase).
 */
function createSupabaseProxyFetch(supabaseUrl) {
  const origin = new URL(supabaseUrl).origin;

  return async function supabaseProxyFetch(input, init) {
    if (!shouldUseDbProxy()) {
      return fetch(input, init);
    }

    const req = new Request(input, init);
    const u = new URL(req.url);

    if (u.origin !== origin) {
      return fetch(input, init);
    }
    if (
      !u.pathname.startsWith("/rest/v1/") &&
      !u.pathname.startsWith("/storage/v1/") &&
      !u.pathname.startsWith("/auth/v1/")
    ) {
      return fetch(input, init);
    }

    const pathWithQuery = u.pathname + u.search;
    const method = req.method.toUpperCase();
    const h = req.headers;

    const proxyUrl = `${window.location.origin}/api/supabase-proxy`;

    if (method === "GET" || method === "HEAD") {
      return fetch(proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: pathWithQuery,
          method,
          headers: headersToObject(h),
        }),
      });
    }

    if (req.body === null) {
      return fetch(proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: pathWithQuery,
          method,
          headers: headersToObject(h),
        }),
      });
    }

    const ct = h.get("Content-Type") || "";

    if (isBinaryUploadContentType(ct)) {
      const proxyHeaders = new Headers();
      proxyHeaders.set("X-Proxy-Path", pathWithQuery);
      proxyHeaders.set("X-Proxy-Method", method);
      h.forEach((value, key) => {
        const lower = key.toLowerCase();
        if (lower === "host" || lower === "content-length") return;
        if (lower.startsWith("x-proxy-")) return;
        proxyHeaders.set(key, value);
      });
      return fetch(proxyUrl, {
        method: "POST",
        headers: proxyHeaders,
        body: req.body,
        duplex: "half",
      });
    }

    const text = await req.text();
    return fetch(proxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: pathWithQuery,
        method,
        headers: headersToObject(h),
        body: text || undefined,
      }),
    });
  };
}

export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
  global: {
    fetch: createSupabaseProxyFetch(SUPABASE_URL),
  },
});
