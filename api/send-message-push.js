/**
 * Webhook: новая строка в user_messages → push получателю с активной подпиской.
 *
 * Env (Vercel): те же, что у send-task-push.js
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
 *   PUSH_WEBHOOK_SECRET — заголовок x-push-webhook-secret
 */

const webpush = require("web-push");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
const PUSH_WEBHOOK_SECRET = process.env.PUSH_WEBHOOK_SECRET;

function isConfigured() {
  return Boolean(
    SUPABASE_URL &&
      SERVICE_ROLE_KEY &&
      VAPID_PUBLIC_KEY &&
      VAPID_PRIVATE_KEY &&
      PUSH_WEBHOOK_SECRET,
  );
}

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
    const text = await res.text();
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("json")) return null;
  return res.json();
}

function extractMessageRecord(body) {
  if (body?.record && typeof body.record === "object") return body.record;
  if (body?.id != null && body?.recipient_id != null) return body;
  return null;
}

function truncate(text, max) {
  const s = String(text ?? "").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function notificationBodyFromMessage(record) {
  const hasPhoto = Boolean(record.attachment_storage_path);
  const raw = String(record.body || "")
    .replace(/\[\[order:\d+\]\]/g, "заказ")
    .replace(/\s+/g, " ")
    .trim();
  if (hasPhoto && raw) return truncate(`Фото · ${raw}`, 120);
  if (hasPhoto) return "Фото";
  return truncate(raw, 120);
}

async function deleteSubscription(id) {
  try {
    await supabaseRest(`push_subscriptions?id=eq.${id}`, { method: "DELETE" });
  } catch (e) {
    console.warn("send-message-push: delete stale subscription failed:", e.message);
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  if (!isConfigured()) {
    const missing = [];
    if (!SUPABASE_URL) missing.push("SUPABASE_URL");
    if (!SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    if (!VAPID_PUBLIC_KEY) missing.push("VAPID_PUBLIC_KEY");
    if (!VAPID_PRIVATE_KEY) missing.push("VAPID_PRIVATE_KEY");
    if (!PUSH_WEBHOOK_SECRET) missing.push("PUSH_WEBHOOK_SECRET");
    return res.status(503).json({
      message: "Push not configured",
      code: "not_configured",
      missing,
      hint: "Добавьте недостающие переменные в Vercel → Environment Variables → Production → Redeploy",
    });
  }

  const secret =
    req.headers["x-push-webhook-secret"] ||
    (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!secret || secret !== PUSH_WEBHOOK_SECRET) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return res.status(400).json({ message: "Invalid JSON body" });
  }

  const record = extractMessageRecord(body);
  if (!record?.id || !record.recipient_id) {
    return res.status(400).json({ message: "Missing message record" });
  }

  if (record.sender_id && record.sender_id === record.recipient_id) {
    return res.status(200).json({ sent: 0, reason: "self_message" });
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  try {
    const recipientId = encodeURIComponent(record.recipient_id);
    const subs = await supabaseRest(
      `push_subscriptions?user_id=eq.${recipientId}&select=id,user_id,endpoint,p256dh,auth`,
    );
    if (!subs?.length) {
      return res.status(200).json({ sent: 0, reason: "no_subscriptions" });
    }

    const author = truncate(record.sender_email || "Пользователь", 40);
    const bodyText = notificationBodyFromMessage(record);
    const payload = JSON.stringify({
      title: "Новое сообщение",
      body: `${author}: ${bodyText || "без текста"}`,
      url: "/messages",
      messageId: record.id,
      tag: `message-${record.id}`,
    });

    let sent = 0;
    const errors = [];

    await Promise.all(
      subs.map(async (sub) => {
        const pushSub = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        };
        try {
          await webpush.sendNotification(pushSub, payload);
          sent += 1;
        } catch (e) {
          errors.push({ id: sub.id, status: e.statusCode, message: e.message });
          if (e.statusCode === 404 || e.statusCode === 410) {
            await deleteSubscription(sub.id);
          }
        }
      }),
    );

    return res.status(200).json({ sent, total: subs.length, errors });
  } catch (e) {
    console.error("send-message-push:", e);
    return res.status(500).json({ message: "Push send failed" });
  }
};
