/**
 * Запускает проверку контрагента через OpenAI Web Search и сохраняет отчет в Supabase.
 *
 * Env (Vercel):
 *   OPENAI_API_KEY, OPENAI_RESEARCH_MODEL (optional)
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

function env(name) {
  return String(process.env[name] || "").trim();
}

function readJsonBody(req) {
  if (req.body != null && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return Promise.resolve(req.body);
  }
  if (typeof req.body === "string") return Promise.resolve(JSON.parse(req.body || "{}"));
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(JSON.parse(raw || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function buildPrompt(companyName, inn) {
  return `У меня компания малый бизнес, которая занимается производством и монтажом пластиковых окон. Мы планируем партнерство с новой компанией - ${companyName}, ИНН ${inn}. Будем закупать у них различные материалы, оплата по безналу.
Нужно проверить деловую репутацию этой компании по открытым источникам. Также смотреть судебную практику и решения. Проведи такое исследование. Дай краткий отчет. Если есть юридические риски или жалобы, важно это подсветить.`;
}

async function fetchJson(url, options, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error?.message || payload?.message || `HTTP ${response.status}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyUser(token, supabaseUrl, anonKey) {
  return fetchJson(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  }, 7000);
}

async function supabaseRest(supabaseUrl, serviceKey, pathWithQuery, options = {}) {
  return fetchJson(`${supabaseUrl}/rest/v1/${pathWithQuery}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  }, options.timeoutMs || 15000);
}

function normalizeContent(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (typeof part === "string" ? part : part?.text || part?.content || ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractSources(message, report) {
  const result = [];
  const seen = new Set();
  const add = (url, title = "") => {
    const cleanUrl = String(url || "").trim().replace(/[),.;]+$/, "");
    if (!/^https?:\/\//i.test(cleanUrl) || seen.has(cleanUrl)) return;
    seen.add(cleanUrl);
    result.push({ url: cleanUrl, title: String(title || cleanUrl).trim().slice(0, 300) });
  };

  for (const annotation of Array.isArray(message?.annotations) ? message.annotations : []) {
    const citation = annotation?.url_citation || annotation;
    add(citation?.url, citation?.title);
  }
  for (const citation of Array.isArray(message?.citations) ? message.citations : []) {
    add(citation?.url || citation, citation?.title);
  }
  for (const match of String(report || "").matchAll(/https?:\/\/[^\s)\]]+/g)) add(match[0]);
  return result.slice(0, 30);
}

async function updateCheck(supabaseUrl, serviceKey, checkId, patch) {
  await supabaseRest(
    supabaseUrl,
    serviceKey,
    `contractor_checks?id=eq.${encodeURIComponent(checkId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    },
  );
}

async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const openaiKey = env("OPENAI_API_KEY");
  const supabaseUrl = env("SUPABASE_URL").replace(/\/$/, "");
  const anonKey = env("SUPABASE_ANON_KEY");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!openaiKey || !supabaseUrl || !anonKey || !serviceKey) {
    return res.status(503).json({ message: "Сервис проверки не настроен" });
  }

  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return res.status(401).json({ message: "Необходима авторизация" });

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return res.status(400).json({ message: "Некорректный JSON" });
  }
  const checkId = String(body?.checkId || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(checkId)) {
    return res.status(400).json({ message: "Некорректный идентификатор проверки" });
  }

  let check;
  try {
    const user = await verifyUser(token, supabaseUrl, anonKey);
    const profiles = await supabaseRest(
      supabaseUrl,
      serviceKey,
      `profiles?id=eq.${encodeURIComponent(user.id)}&select=role`,
    );
    if (!profiles?.length || !["admin", "user"].includes(profiles[0].role)) {
      return res.status(403).json({ message: "Недостаточно прав" });
    }

    const rows = await supabaseRest(
      supabaseUrl,
      serviceKey,
      `contractor_checks?id=eq.${encodeURIComponent(checkId)}&select=id,company_name,inn,status`,
    );
    check = rows?.[0];
    if (!check) return res.status(404).json({ message: "Проверка не найдена" });
    if (check.status === "ready") return res.status(200).json({ ok: true, status: "ready" });

    const openaiPayload = await fetchJson(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env("OPENAI_RESEARCH_MODEL") || "gpt-5-search-api",
        web_search_options: { search_context_size: "high" },
        messages: [{ role: "user", content: buildPrompt(check.company_name, check.inn) }],
      }),
    }, 52000);

    const message = openaiPayload?.choices?.[0]?.message;
    const report = normalizeContent(message?.content);
    if (!report) throw new Error("OpenAI вернул пустой отчет");

    await updateCheck(supabaseUrl, serviceKey, checkId, {
      status: "ready",
      report_markdown: report,
      sources: extractSources(message, report),
      error_message: null,
      completed_at: new Date().toISOString(),
    });
    return res.status(200).json({ ok: true, status: "ready" });
  } catch (error) {
    console.error("contractor-check:", error);
    if (check) {
      try {
        await updateCheck(supabaseUrl, serviceKey, checkId, {
          status: "error",
          error_message: String(error?.message || "Не удалось выполнить проверку").slice(0, 500),
        });
      } catch (updateError) {
        console.error("contractor-check: unable to save error", updateError);
      }
    }
    return res.status(500).json({ message: "Не удалось выполнить проверку. Попробуйте еще раз позже." });
  }
}

module.exports = handler;
module.exports.buildPrompt = buildPrompt;
module.exports.extractSources = extractSources;

