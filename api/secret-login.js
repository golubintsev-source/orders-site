/**
 * Секретный вход без пароля для заранее заданных пользователей.
 *
 * Переменные окружения в Vercel:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY — service role (только на сервере, не в клиенте)
 *   SECRET_LOGIN_TOKEN_GOLUBINTSEV — секрет из URL для golubintsev26@gmail.com
 */

const crypto = require("crypto");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SECRET_LOGINS = [
  {
    email: "golubintsev26@gmail.com",
    token: process.env.SECRET_LOGIN_TOKEN_GOLUBINTSEV,
  },
];

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function findLoginByToken(token) {
  if (!token || typeof token !== "string") return null;
  for (const entry of SECRET_LOGINS) {
    if (entry.token && timingSafeEqual(token, entry.token)) {
      return entry;
    }
  }
  return null;
}

async function createSessionForEmail(email) {
  const base = SUPABASE_URL.replace(/\/$/, "");
  const adminHeaders = {
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    apikey: SERVICE_ROLE_KEY,
    "Content-Type": "application/json",
  };

  const genRes = await fetch(`${base}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ type: "magiclink", email }),
  });

  if (!genRes.ok) {
    const text = await genRes.text();
    throw new Error(`generate_link ${genRes.status}: ${text}`);
  }

  const genData = await genRes.json();
  const tokenHash = genData?.properties?.hashed_token;
  if (!tokenHash) {
    throw new Error("generate_link: missing hashed_token");
  }

  const verifyRes = await fetch(`${base}/auth/v1/verify`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ token_hash: tokenHash, type: "email" }),
  });

  if (!verifyRes.ok) {
    const text = await verifyRes.text();
    throw new Error(`verify ${verifyRes.status}: ${text}`);
  }

  return verifyRes.json();
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

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(503).json({ message: "Secret login not configured" });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return res.status(400).json({ message: "Invalid JSON body" });
  }

  const login = findLoginByToken(body?.token);
  if (!login) {
    return res.status(401).json({ message: "Invalid token" });
  }

  try {
    const session = await createSessionForEmail(login.email);
    if (!session?.access_token || !session?.refresh_token) {
      throw new Error("verify: missing session tokens");
    }
    return res.status(200).json({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
    });
  } catch (e) {
    console.error("secret-login:", e);
    return res.status(500).json({ message: "Login failed" });
  }
};
