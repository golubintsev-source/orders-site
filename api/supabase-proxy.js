/**
 * Прокси PostgREST и Storage на Supabase через Vercel (сервер → Supabase).
 * Клиент ходит на same-origin /api/supabase-proxy, а не напрямую в *.supabase.co.
 *
 * Переменные окружения в Vercel:
 *   SUPABASE_URL       — https://xxxx.supabase.co
 *   SUPABASE_ANON_KEY  — anon key (тот же, что на клиенте)
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const ALLOWED_PREFIXES = ["/rest/v1/", "/storage/v1/"];

function isAllowedPath(p) {
  return typeof p === "string" && ALLOWED_PREFIXES.some((prefix) => p.startsWith(prefix));
}

function readBodyStream(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function mergeUpstreamHeaders(fromJson, fromReqHeaders) {
  const out = {};
  if (fromJson && typeof fromJson === "object") {
    Object.assign(out, fromJson);
  }
  const h = fromReqHeaders || {};
  const pass = new Set([
    "authorization",
    "apikey",
    "content-type",
    "prefer",
    "accept",
    "range",
    "accept-profile",
    "content-profile",
    "cache-control",
    "x-upsert",
    "x-client-info",
  ]);
  for (const [key, value] of Object.entries(h)) {
    const lower = key.toLowerCase();
    if (lower.startsWith("x-proxy-")) continue;
    if (lower.startsWith("x-forwarded")) continue;
    if (lower.startsWith("x-vercel")) continue;
    if (lower === "host" || lower === "connection" || lower === "content-length") continue;
    if (pass.has(lower) || lower.startsWith("x-")) {
      if (out[key] == null) out[key] = value;
    }
  }
  return out;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ message: "Missing SUPABASE_URL or SUPABASE_ANON_KEY" });
  }

  const base = SUPABASE_URL.replace(/\/$/, "");
  const contentType = (req.headers["content-type"] || "").toLowerCase();

  let targetPath;
  let method;
  let upstreamHeaders = {};
  let body;

  if (contentType.includes("application/json")) {
    let json;
    try {
      if (req.body != null && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
        json = req.body;
      } else if (typeof req.body === "string") {
        json = JSON.parse(req.body || "{}");
      } else {
        const raw = await readBodyStream(req);
        json = JSON.parse(raw.length ? raw.toString("utf8") : "{}");
      }
    } catch {
      return res.status(400).json({ message: "Invalid JSON body" });
    }

    targetPath = json.path;
    method = String(json.method || "GET").toUpperCase();
    upstreamHeaders = mergeUpstreamHeaders(json.headers, req.headers);
    if (json.body !== undefined && json.body !== null) {
      body =
        typeof json.body === "string"
          ? json.body
          : JSON.stringify(json.body);
      if (!upstreamHeaders["Content-Type"] && !upstreamHeaders["content-type"]) {
        upstreamHeaders["Content-Type"] = "application/json";
      }
    }
  } else {
    targetPath = req.headers["x-proxy-path"];
    method = String(req.headers["x-proxy-method"] || "GET").toUpperCase();
    upstreamHeaders = mergeUpstreamHeaders(null, req.headers);
    if (method !== "GET" && method !== "HEAD") {
      const raw = await readBodyStream(req);
      body = raw.length ? raw : undefined;
    }
  }

  if (!isAllowedPath(targetPath)) {
    return res.status(400).json({ message: "Invalid or disallowed path" });
  }

  if (!upstreamHeaders.apikey && !upstreamHeaders.Apikey) {
    upstreamHeaders.apikey = SUPABASE_ANON_KEY;
  }

  const url = `${base}${targetPath.startsWith("/") ? "" : "/"}${targetPath}`;

  const upstreamInit = {
    method,
    headers: upstreamHeaders,
  };
  if (body !== undefined && method !== "GET" && method !== "HEAD") {
    upstreamInit.body = body;
  }

  let upstream;
  try {
    upstream = await fetch(url, upstreamInit);
  } catch (e) {
    console.error("supabase-proxy upstream:", e);
    return res.status(502).json({ message: "Upstream unreachable" });
  }

  const buf = Buffer.from(await upstream.arrayBuffer());

  res.status(upstream.status);
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (
      lower === "transfer-encoding" ||
      lower === "connection" ||
      lower === "content-encoding" ||
      lower === "content-length"
    ) {
      return;
    }
    res.setHeader(key, value);
  });
  res.setHeader("Content-Length", buf.length);
  res.send(buf);
};
