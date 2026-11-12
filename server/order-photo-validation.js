/**
 * Проверка содержимого изображения перед прикреплением к заказу.
 * Изображение не сохраняется: в OpenAI отправляется уменьшенная копия только для классификации.
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_PHOTO_VALIDATION_MODEL = process.env.OPENAI_PHOTO_VALIDATION_MODEL || "gpt-4o-mini";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://yizwpogwabosuguakyzt.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_e1pJB18UsEV-o_M43ROi9w_4mS--LrF";

const MAX_DATA_URL_LENGTH = 2_000_000;
const ALLOWED_IMAGE_DATA_URL = /^data:image\/(?:jpeg|png|webp|gif);base64,[a-z0-9+/=\s]+$/i;

const REASONS = {
  table_screenshot: "на изображении видна таблица или рабочий документ",
  handwritten_text: "на изображении виден рукописный текст",
  hand_drawn_sketch: "на изображении виден рисунок или схема от руки",
  pet: "фотографии животных нельзя прикреплять к заказу",
  nature: "фотографии природы нельзя прикреплять к заказу",
  blank: "изображение пустое или почти пустое",
  empty_screenshot: "на скриншоте нет таблицы, документа или полезных данных",
  desktop_without_open_file: "на скриншоте виден только рабочий стол без открытого файла",
  unrelated_photo: "изображение не относится к разрешённым документам заказа",
  uncertain: "не удалось подтвердить, что изображение содержит таблицу, рукописный текст или рисунок от руки",
};

function readJsonBody(req) {
  if (req.body != null && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  if (typeof req.body === "string") return Promise.resolve(JSON.parse(req.body || "{}"));
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_DATA_URL_LENGTH + 50_000) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function bearerToken(req) {
  const match = String(req.headers?.authorization || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function verifySupabaseUser(token) {
  if (!token) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: "GET",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  return user?.id ? user : null;
}

async function isPhotoValidationEnabled(token) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/app_settings?select=value&key=eq.order_photo_validation_enabled`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`app_settings_${response.status}`);
  const rows = await response.json();
  return rows[0]?.value !== "false";
}

function extractAssistantJson(payload) {
  const raw = payload?.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || !raw.trim()) throw new Error("empty_model_response");
  return JSON.parse(raw);
}

async function classifyImage(imageDataUrl) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_PHOTO_VALIDATION_MODEL,
      temperature: 0,
      max_tokens: 120,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "order_photo_check",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              decision: { type: "string", enum: ["allow", "block"] },
              category: { type: "string", enum: Object.keys(REASONS) },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["decision", "category", "confidence"],
          },
        },
      },
      messages: [
        {
          role: "system",
          content:
            "Ты проверяешь изображения, которые сотрудники прикрепляют к заказам оконной компании. " +
            "Разрешай ТОЛЬКО: (1) скриншот с явно видимой таблицей, строками/столбцами или открытым рабочим документом с табличными данными; " +
            "(2) фотографию рукописного текста; (3) фотографию рисунка, эскиза, размеров или схемы, сделанных ручкой или карандашом. " +
            "Блокируй животных, людей без документа, природу, бытовые и любые посторонние фотографии, пустые/однотонные/неразборчивые изображения, " +
            "пустые скриншоты, интерфейс без полезного открытого файла и рабочий стол без открытых файлов. " +
            "Если содержание нельзя уверенно отнести к разрешённым категориям, выбери block и uncertain. " +
            "Категория должна точно соответствовать решению: allow только для table_screenshot, handwritten_text или hand_drawn_sketch.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Проверь это изображение перед прикреплением к заказу." },
            { type: "image_url", image_url: { url: imageDataUrl, detail: "low" } },
          ],
        },
      ],
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("OpenAI photo validation error:", response.status, detail.slice(0, 500));
    throw new Error(`openai_${response.status}`);
  }
  return extractAssistantJson(await response.json());
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }
  const token = bearerToken(req);
  let user;
  try {
    user = await verifySupabaseUser(token);
  } catch (error) {
    console.error("Photo validation auth error:", error);
    return res.status(503).json({ message: "Не удалось проверить авторизацию. Повторите попытку." });
  }
  if (!user) return res.status(401).json({ message: "Требуется авторизация" });

  try {
    if (!(await isPhotoValidationEnabled(token))) {
      return res.status(200).json({ allowed: true, category: "validation_disabled" });
    }
  } catch (error) {
    console.error("Photo validation setting error:", error);
    return res.status(503).json({ message: "Не удалось загрузить настройку проверки фото. Повторите попытку." });
  }
  if (!OPENAI_API_KEY) {
    return res.status(503).json({ message: "Проверка фотографий временно не настроена. Обратитесь к администратору.", code: "not_configured" });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return res.status(400).json({ message: "Некорректные данные изображения" });
  }
  const imageDataUrl = String(body?.imageDataUrl || "");
  if (!imageDataUrl || imageDataUrl.length > MAX_DATA_URL_LENGTH || !ALLOWED_IMAGE_DATA_URL.test(imageDataUrl)) {
    return res.status(400).json({ message: "Неподдерживаемый или слишком большой файл изображения" });
  }

  try {
    const result = await classifyImage(imageDataUrl);
    const allowedCategories = new Set(["table_screenshot", "handwritten_text", "hand_drawn_sketch"]);
    const category = Object.prototype.hasOwnProperty.call(REASONS, result?.category) ? result.category : "uncertain";
    const allowed = result?.decision === "allow" && allowedCategories.has(category);
    return res.status(200).json({
      allowed,
      category,
      confidence: Number.isFinite(result?.confidence) ? result.confidence : null,
      reason: REASONS[category] || REASONS.uncertain,
    });
  } catch (error) {
    console.error("Photo validation failed:", error);
    return res.status(503).json({ message: "Не удалось проверить содержимое фото. Повторите попытку.", code: "validation_unavailable" });
  }
};

module.exports.classifyImage = classifyImage;
module.exports.extractAssistantJson = extractAssistantJson;
module.exports.REASONS = REASONS;
