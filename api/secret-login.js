/**
 * Вход без пароля по уникальной ссылке: login.html?key=...
 *
 * Источники ключа (проверяются по порядку):
 *   1. profiles.login_key в Supabase (уникальная ссылка для каждого пользователя)
 *   2. SECRET_LOGIN_TOKEN_* в переменных окружения (обратная совместимость)
 *
 * Переменные окружения в Vercel:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY — для поиска login_key и создания сессии (предпочтительно)
 *   SECRET_LOGIN_TOKEN_GOLUBINTSEV — опционально, для golubintsev26@gmail.com
 *   SUPABASE_ANON_KEY + SECRET_LOGIN_PASSWORD_GOLUBINTSEV — запасной вариант без service role
 */

const crypto = require("crypto");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

const SECRET_LOGINS = [
  {
    email: "golubintsev26@gmail.com",
    token: process.env.SECRET_LOGIN_TOKEN_GOLUBINTSEV,
    password: process.env.SECRET_LOGIN_PASSWORD_GOLUBINTSEV,
  },
];

function isSecretLoginConfigured() {
  if (!SUPABASE_URL) return false;
  if (SERVICE_ROLE_KEY) return true;
  return Boolean(ANON_KEY && SECRET_LOGINS.some((e) => e.token && e.password));
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function normalizeToken(value) {
  return typeof value === "string" ? value.trim() : "";
}

function findLoginByEnvToken(token) {
  const normalized = normalizeToken(token);
  if (!normalized) return null;
  for (const entry of SECRET_LOGINS) {
    const expected = normalizeToken(entry.token);
    if (expected && timingSafeEqual(normalized, expected)) {
      return entry;
    }
  }
  return null;
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

async function fetchAuthUserEmail(userId) {
  const base = SUPABASE_URL.replace(/\/$/, "");
  const res = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return typeof data?.email === "string" ? data.email.trim() : null;
}

async function findLoginByProfileKey(token) {
  if (!SERVICE_ROLE_KEY) return null;
  const normalized = normalizeToken(token);
  if (!normalized) return null;

  const rows = await supabaseRest(
    `profiles?login_key=eq.${encodeURIComponent(normalized)}&select=id,email&limit=1`,
  );
  const row = rows?.[0];
  if (!row?.id) return null;

  const authEmail = await fetchAuthUserEmail(row.id);
  const profileEmail = typeof row.email === "string" ? row.email.trim() : "";
  const email = authEmail || profileEmail;
  if (!email) return null;
  return { email };
}

async function findLoginByToken(token) {
  const fromEnv = findLoginByEnvToken(token);
  if (fromEnv) return fromEnv;
  return findLoginByProfileKey(token);
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

  const verifyTypes = [
    genData?.properties?.verification_type,
    "magiclink",
    "email",
  ].filter((t, i, arr) => typeof t === "string" && t && arr.indexOf(t) === i);

  let lastVerifyError = null;
  for (const verifyType of verifyTypes) {
    const verifyRes = await fetch(`${base}/auth/v1/verify`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ token_hash: tokenHash, type: verifyType }),
    });

    if (verifyRes.ok) {
      return verifyRes.json();
    }

    lastVerifyError = `verify ${verifyRes.status} (${verifyType}): ${await verifyRes.text()}`;
  }

  throw new Error(lastVerifyError || "verify failed");
}

async function createSessionWithPassword(email, password) {
  const base = SUPABASE_URL.replace(/\/$/, "");
  const res = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`password grant ${res.status}: ${text}`);
  }

  return res.json();
}

async function createSessionForLogin(login) {
  if (SERVICE_ROLE_KEY) {
    try {
      return await createSessionForEmail(login.email);
    } catch (e) {
      if (login.password && ANON_KEY) {
        console.warn("secret-login: admin link failed, trying password grant:", e.message);
        return createSessionWithPassword(login.email, login.password);
      }
      throw e;
    }
  }
  if (login.password && ANON_KEY) {
    return createSessionWithPassword(login.email, login.password);
  }
  throw new Error("No auth method configured for secret login");
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

  if (!isSecretLoginConfigured()) {
    return res.status(503).json({
      message: "Secret login not configured",
      code: "not_configured",
    });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return res.status(400).json({ message: "Invalid JSON body" });
  }

  let login;
  try {
    login = await findLoginByToken(body?.token);
  } catch (e) {
    console.error("secret-login lookup:", e);
    return res.status(500).json({ message: "Login lookup failed" });
  }
  if (!login) {
    return res.status(401).json({ message: "Invalid token" });
  }

  try {
    const session = await createSessionForLogin(login);
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
