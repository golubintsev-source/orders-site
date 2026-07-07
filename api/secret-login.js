/**
 * Вход без пароля по уникальной ссылке: login.html?key=...
 *
 * Источники ключа:
 *   1. profiles.login_key в Supabase
 *   2. SECRET_LOGIN_TOKEN_* в переменных окружения
 *
 * Переменные окружения в Vercel:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_ANON_KEY — legacy JWT-ключ (eyJ...), не sb_publishable_
 *   SECRET_LOGIN_TOKEN_GOLUBINTSEV / SECRET_LOGIN_PASSWORD_GOLUBINTSEV — опционально
 */

const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const HAS_LEGACY_ANON = typeof ANON_KEY === "string" && ANON_KEY.startsWith("eyJ");

const SECRET_LOGINS = [
  {
    email: "golubintsev26@gmail.com",
    token: process.env.SECRET_LOGIN_TOKEN_GOLUBINTSEV,
    password: process.env.SECRET_LOGIN_PASSWORD_GOLUBINTSEV,
  },
];

let adminClient = null;

function getAdminClient() {
  if (!adminClient) {
    adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return adminClient;
}

function getAnonClient() {
  if (!HAS_LEGACY_ANON) return null;
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function isSecretLoginConfigured() {
  if (!SUPABASE_URL) return false;
  if (SERVICE_ROLE_KEY) return true;
  return Boolean(HAS_LEGACY_ANON && SECRET_LOGINS.some((e) => e.token && e.password));
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

async function fetchAuthUser(userId) {
  const { data, error } = await getAdminClient().auth.admin.getUserById(userId);
  if (error || !data?.user) return null;
  return data.user;
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

  const authUser = await fetchAuthUser(row.id);
  const profileEmail = typeof row.email === "string" ? row.email.trim() : "";
  const email = (authUser?.email || profileEmail || "").trim();
  if (!email) return null;
  return { email, userId: row.id };
}

async function findLoginByToken(token) {
  const fromEnv = findLoginByEnvToken(token);
  if (fromEnv) return fromEnv;
  return findLoginByProfileKey(token);
}

function extractTokenFromActionLink(actionLink) {
  if (typeof actionLink !== "string" || !actionLink) return null;
  try {
    return new URL(actionLink).searchParams.get("token");
  } catch {
    return null;
  }
}

function sessionFromVerifyData(data) {
  const session = data?.session;
  if (!session?.access_token || !session?.refresh_token) return null;
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
  };
}

async function ensureEmailConfirmed(userId) {
  const user = await fetchAuthUser(userId);
  if (!user) {
    throw new Error(`auth user not found: ${userId}`);
  }
  if (!user.email_confirmed_at) {
    const { error } = await getAdminClient().auth.admin.updateUserById(userId, {
      email_confirm: true,
    });
    if (error) {
      throw new Error(`confirm email failed: ${error.message}`);
    }
  }
  return user;
}

async function verifyOtpWithClients(params) {
  const clients = [getAnonClient(), getAdminClient()].filter(Boolean);
  let lastError = "verifyOtp failed";

  for (const client of clients) {
    const { data, error } = await client.auth.verifyOtp(params);
    const session = sessionFromVerifyData(data);
    if (!error && session) return session;
    if (error?.message) lastError = error.message;
  }

  throw new Error(lastError);
}

async function createSessionWithSdk(email, userId) {
  let resolvedEmail = email;
  if (userId) {
    const user = await ensureEmailConfirmed(userId);
    if (user.email) resolvedEmail = user.email.trim();
  }

  let lastError = "verifyOtp failed";
  for (const linkType of ["magiclink", "recovery"]) {
    const { data: linkData, error: linkError } = await getAdminClient().auth.admin.generateLink({
      type: linkType,
      email: resolvedEmail,
    });
    if (linkError) {
      lastError = `generate_link(${linkType}): ${linkError.message}`;
      continue;
    }

    const props = linkData?.properties || {};
    const verifyTypes = [props.verification_type, linkType, "magiclink", "email"].filter(
      (t, i, arr) => typeof t === "string" && t && arr.indexOf(t) === i,
    );
    const plainToken = extractTokenFromActionLink(props.action_link);
    const attempts = [];

    if (props.email_otp) {
      for (const verifyType of ["email", "magiclink", linkType]) {
        attempts.push({ email: resolvedEmail, token: props.email_otp, type: verifyType });
      }
    }
    for (const verifyType of verifyTypes) {
      if (props.hashed_token) {
        attempts.push({ email: resolvedEmail, token_hash: props.hashed_token, type: verifyType });
      }
      if (plainToken) {
        attempts.push({ email: resolvedEmail, token: plainToken, type: verifyType });
      }
    }

    for (const params of attempts) {
      try {
        return await verifyOtpWithClients(params);
      } catch (e) {
        lastError = e.message;
      }
    }
  }

  throw new Error(lastError);
}

async function createSessionWithPassword(email, password) {
  if (!HAS_LEGACY_ANON) {
    throw new Error("SUPABASE_ANON_KEY (legacy eyJ...) required for password grant");
  }

  const { data, error } = await getAnonClient().auth.signInWithPassword({ email, password });
  const session = sessionFromVerifyData(data);
  if (error || !session) {
    throw new Error(`password grant: ${error?.message || "missing session"}`);
  }
  return session;
}

async function createSessionForLogin(login) {
  const { email, userId, password } = login;

  if (SERVICE_ROLE_KEY) {
    try {
      return await createSessionWithSdk(email, userId);
    } catch (sdkError) {
      console.warn("secret-login: sdk failed:", sdkError.message);

      if (password && HAS_LEGACY_ANON) {
        console.warn("secret-login: trying password grant fallback");
        return createSessionWithPassword(email, password);
      }

      if (!HAS_LEGACY_ANON) {
        throw new Error(
          "verifyOtp failed; add SUPABASE_ANON_KEY (legacy eyJ...) on Vercel — Supabase → Settings → API → anon public",
        );
      }

      throw sdkError;
    }
  }

  if (password && HAS_LEGACY_ANON) {
    return createSessionWithPassword(email, password);
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
    return res.status(500).json({ message: "Login lookup failed", detail: e.message });
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
    return res.status(500).json({ message: "Login failed", detail: e.message });
  }
};
