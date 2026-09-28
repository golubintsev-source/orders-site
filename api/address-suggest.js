/**
 * Адресные подсказки через DaData (ФИАС/ГАР).
 *
 * Env (Vercel):
 *   DADATA_API_KEY — API-ключ подсказок DaData
 *   SUPABASE_URL, SUPABASE_ANON_KEY — проверка сессии пользователя
 */

const VOLGOGRAD_KLADR_ID = "3400000100000";
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;
const TOKEN_CACHE_MAX = 200;
const verifiedTokens = new Map();

function env(name) {
  return String(process.env[name] || "").trim();
}

function rememberVerifiedToken(token) {
  verifiedTokens.delete(token);
  while (verifiedTokens.size >= TOKEN_CACHE_MAX) {
    const oldest = verifiedTokens.keys().next().value;
    if (oldest == null) break;
    verifiedTokens.delete(oldest);
  }
  verifiedTokens.set(token, Date.now() + TOKEN_CACHE_TTL_MS);
}

async function hasValidSession(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;

  const cachedUntil = verifiedTokens.get(token) || 0;
  if (cachedUntil > Date.now()) return true;
  if (cachedUntil) verifiedTokens.delete(token);

  const supabaseUrl = env("SUPABASE_URL").replace(/\/$/, "");
  const anonKey = env("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: "GET",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!response.ok) return false;
    rememberVerifiedToken(token);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function mapDadataSuggestions(payload) {
  const items = [];
  const seen = new Set();
  for (const row of Array.isArray(payload?.suggestions) ? payload.suggestions : []) {
    const value = String(row?.value || row?.unrestricted_value || "").trim();
    const locality = String(
      row?.data?.city_with_type ||
        row?.data?.settlement_with_type ||
        row?.data?.region_with_type ||
        "",
    ).trim();
    const postalCode = String(row?.data?.postal_code || "").trim();
    const subtitle = [locality, postalCode ? `индекс ${postalCode}` : ""].filter(Boolean).join(" · ");
    const key = value.toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
    if (!value || seen.has(key)) continue;
    seen.add(key);
    items.push({ value, title: value, subtitle });
    if (items.length >= 10) break;
  }
  return items;
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "private, no-store, max-age=0");

  const apiKey = env("DADATA_API_KEY");
  if (!apiKey) {
    return res.status(503).json({
      message: "Адресные подсказки не настроены",
      code: "not_configured",
    });
  }

  if (!(await hasValidSession(req))) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const rawText = Array.isArray(req.query?.text) ? req.query.text[0] : req.query?.text;
  const text = String(rawText || "").trim().slice(0, 180);
  if (text.length < 3) return res.status(200).json({ items: [] });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const upstream = await fetch(
      "https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Token ${apiKey}`,
        },
        body: JSON.stringify({
          query: text,
          count: 10,
          locations_boost: [{ kladr_id: VOLGOGRAD_KLADR_ID }],
        }),
        signal: controller.signal,
      },
    );
    if (!upstream.ok) {
      return res.status(upstream.status === 429 ? 429 : 502).json({
        message: "Сервис адресных подсказок временно недоступен",
        code: upstream.status === 429 ? "rate_limited" : "upstream_error",
      });
    }
    const payload = await upstream.json();
    return res.status(200).json({ items: mapDadataSuggestions(payload) });
  } catch (error) {
    return res.status(502).json({
      message: error?.name === "AbortError" ? "Сервис адресов не ответил вовремя" : "Ошибка адресных подсказок",
      code: error?.name === "AbortError" ? "timeout" : "network_error",
    });
  } finally {
    clearTimeout(timeout);
  }
};

module.exports.mapDadataSuggestions = mapDadataSuggestions;
