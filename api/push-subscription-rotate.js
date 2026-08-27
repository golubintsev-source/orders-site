/**
 * Обмен push-подписки при её перевыпуске браузером (событие pushsubscriptionchange).
 *
 * Service worker вызывает эндпоинт без пользовательского JWT: событие приходит,
 * когда приложение закрыто. Право на замену подтверждает сам старый endpoint —
 * его знает только владелец подписки, как в ссылках отписки. Пользователя из
 * запроса не берём: user_id переносится из найденной строки.
 *
 * Env (Vercel): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function readJsonBody(req) {
  if (req.body != null && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === "string") {
    return JSON.parse(req.body || "{}");
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks);
        resolve(JSON.parse(raw.length ? raw.toString("utf8") : "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

async function supabaseRest(pathWithQuery, options = {}) {
  const base = SUPABASE_URL.replace(/\/$/, "");
  const res = await fetch(`${base}/rest/v1/${pathWithQuery}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") || "";
  return ct.includes("json") ? res.json() : null;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(503).json({ message: "Push not configured", code: "not_configured" });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return res.status(400).json({ message: "Invalid JSON body" });
  }

  const oldEndpoint = String(body?.oldEndpoint || "").trim();
  const next = body?.subscription || {};
  const endpoint = String(next.endpoint || "").trim();
  const p256dh = String(next.keys?.p256dh || "").trim();
  const auth = String(next.keys?.auth || "").trim();

  if (!oldEndpoint || !endpoint || !p256dh || !auth) {
    return res.status(400).json({ message: "Missing subscription" });
  }

  try {
    const existing = await supabaseRest(
      `push_subscriptions?endpoint=eq.${encodeURIComponent(oldEndpoint)}&select=id,user_id`,
    );
    const row = Array.isArray(existing) ? existing[0] : null;
    if (!row) {
      return res.status(404).json({ message: "Unknown subscription" });
    }

    if (endpoint !== oldEndpoint) {
      // Тот же браузер мог уже записать новый endpoint при открытии приложения.
      await supabaseRest(
        `push_subscriptions?user_id=eq.${encodeURIComponent(row.user_id)}&endpoint=eq.${encodeURIComponent(endpoint)}`,
        { method: "DELETE" },
      );
    }

    await supabaseRest(`push_subscriptions?id=eq.${row.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        endpoint,
        p256dh,
        auth,
        updated_at: new Date().toISOString(),
      }),
    });

    return res.status(200).json({ rotated: true });
  } catch (e) {
    console.error("push-subscription-rotate:", e);
    return res.status(500).json({ message: "Rotate failed" });
  }
};
