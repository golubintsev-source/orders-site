import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

process.env.OPENAI_API_KEY = "test-key";
const require = createRequire(import.meta.url);
const handler = require(path.join(root, "server", "order-photo-validation.js"));

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

async function callHandler({ token = "valid-jwt", category, decision }) {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/auth/v1/user")) {
      return { ok: token === "valid-jwt", json: async () => ({ id: "user-1" }) };
    }
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ decision, category, confidence: 0.98 }) } }],
      }),
    };
  };
  const req = {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: { imageDataUrl: "data:image/jpeg;base64,AA==" },
  };
  const res = responseRecorder();
  await handler(req, res);
  return { res, calls };
}

const allowed = await callHandler({ category: "table_screenshot", decision: "allow" });
assert.equal(allowed.res.statusCode, 200);
assert.equal(allowed.res.payload.allowed, true);
assert.equal(allowed.calls.length, 2);
assert.match(allowed.calls[1].url, /api\.openai\.com\/v1\/chat\/completions/);
const openAiBody = JSON.parse(allowed.calls[1].init.body);
assert.match(openAiBody.messages[0].content, /скриншот с явно видимой таблицей/);
assert.equal(openAiBody.messages[1].content[1].image_url.detail, "low");

const blocked = await callHandler({ category: "pet", decision: "block" });
assert.equal(blocked.res.statusCode, 200);
assert.equal(blocked.res.payload.allowed, false);
assert.match(blocked.res.payload.reason, /животных/);

const inconsistent = await callHandler({ category: "pet", decision: "allow" });
assert.equal(inconsistent.res.payload.allowed, false, "allow нельзя принять для запрещённой категории");

const unauthorized = await callHandler({ token: "", category: "table_screenshot", decision: "allow" });
assert.equal(unauthorized.res.statusCode, 401);
assert.equal(unauthorized.calls.length, 0, "без JWT нельзя вызывать ни Supabase, ни OpenAI");

const filesSource = fs.readFileSync(path.join(root, "js", "files.js"), "utf8");
assert.match(filesSource, /await validateOrderPhoto\(toAdd\)/, "выбранное фото проверяется до добавления");
assert.match(filesSource, /await validateOrderPhoto\(file\)/, "фото повторно проверяется перед загрузкой");
assert.match(filesSource, /await validateOrderPhoto\(fileForValidation\)/, "фото из чата проверяется перед прикреплением");
assert.match(filesSource, /await waitForPendingAttachmentChecks\(\)/, "сохранение ждёт незавершённую проверку фото");

const ordersSource = fs.readFileSync(path.join(root, "js", "orders.js"), "utf8");
assert.match(ordersSource, /await waitForPendingAttachmentChecks\(\);\s*const hasPendingPhoto/, "напоминание о фото ждёт результат проверки");

const clientSource = fs.readFileSync(path.join(root, "js", "order-photo-validation.js"), "utf8");
assert.match(clientSource, /MAX_ANALYSIS_DIMENSION = 1024/);
assert.match(clientSource, /supabaseClient\.auth\.getSession\(\)/);
assert.match(clientSource, /Authorization: `Bearer \$\{token\}`/);
assert.match(clientSource, /voice-assistant\?mode=photo-validation/);

const voiceSource = fs.readFileSync(path.join(root, "api", "voice-assistant.js"), "utf8");
assert.match(voiceSource, /orderPhotoValidationHandler/);
assert.match(voiceSource, /mode === "photo-validation"/);

const apiFunctionCount = fs.readdirSync(path.join(root, "api")).filter((name) => name.endsWith(".js")).length;
assert.ok(apiFunctionCount <= 12, `Vercel function limit exceeded: ${apiFunctionCount}`);

console.log("order photo validation tests passed");
