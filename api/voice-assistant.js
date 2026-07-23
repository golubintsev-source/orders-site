/**
 * Голосовой ассистент: разбор свободной речи через OpenAI.
 *
 * Env (Vercel):
 *   OPENAI_API_KEY — ключ OpenAI
 *   OPENAI_MODEL   — опционально, по умолчанию gpt-4o-mini
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const ORDER_TYPES = ["Окна", "Подоконники", "Аллюминий", "Магазин", "Сетки/мелочь"];
const PAYMENT_STATUSES = [
  "Контакт с клиентом",
  "Замер назначен",
  "Замер проведен",
  "Расчет сформирован",
  "Предложение направлено",
  "Клиент согласен",
  "Производство",
  "Товар передан заказчику",
  "Монтаж выполнен",
  "Заказ закрыт",
];
const MONEY_TO = ["Дима", "Вова", "Безнал", "Касса"];
const DELIVERY = ["Доставка", "Самовывоз"];

function readJsonBody(req) {
  if (req.body != null && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return Promise.resolve(req.body);
  }
  if (typeof req.body === "string") {
    return Promise.resolve(JSON.parse(req.body || "{}"));
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

function buildSystemPrompt({ canCreateOrders, nowIso }) {
  return `Ты голосовой ассистент сайта учёта заказов. Отвечай кратко, по-русски, фразами удобными для озвучки (1–3 предложения).

Сейчас: ${nowIso}

Данные заказов переданы в блоке SITE_ORDERS_JSON (массив объектов). Используй только эти данные и сообщение пользователя. Не выдумывай номера заказов и суммы.

Поля заказа: id, client, phone, address, description, order_type, payment_status, order_date, amount, prepayment, prepayment_to, remaining_amount, remaining_to, delivery, delivery_date, installation, installation_date, area_m2.

«Последний заказ» = заказ с наибольшим id среди доступных.
Если данных не хватает — скажи об этом честно.

Действия (поле action):
- "answer" — обычный ответ по данным (вопросы о сумме, адресе, клиенте, статусе и т.п.)
- "clarify" — нужно уточнение у пользователя
- "propose_create_order" — пользователь хочет СОЗДАТЬ новый заказ; заполни order извлечёнными полями. Создание на сайте подтвердит пользователь отдельно. ${
    canCreateOrders
      ? "Создание заказов разрешено."
      : "Создание заказов ЗАПРЕЩЕНО для этой роли — откажи и предложи только ответы по данным."
  }

Допустимые значения при создании:
- order_type: ${ORDER_TYPES.join(" | ")} или null
- payment_status: ${PAYMENT_STATUSES.join(" | ")}. Если не сказано — "Контакт с клиентом"
- prepayment_to / remaining_to: ${MONEY_TO.join(" | ")} или null
- delivery: ${DELIVERY.join(" | ")} или null
- amount, prepayment, remaining_amount — целые рубли (числа) или null
- installation — boolean
- даты — ISO YYYY-MM-DD или null; order_date можно оставить null (подставится сейчас)

Верни ТОЛЬКО JSON-объект без markdown:
{
  "speak": "текст для озвучки",
  "action": "answer" | "clarify" | "propose_create_order",
  "order": null | {
    "client": string|null,
    "phone": string|null,
    "address": string|null,
    "description": string|null,
    "order_type": string|null,
    "payment_status": string|null,
    "order_date": string|null,
    "amount": number|null,
    "prepayment": number|null,
    "prepayment_to": string|null,
    "remaining_amount": number|null,
    "remaining_to": string|null,
    "delivery": string|null,
    "delivery_date": string|null,
    "installation": boolean|null,
    "installation_date": string|null,
    "area_m2": number|null,
    "mosquito_nets": number|null,
    "construction_count": number|null
  }
}`;
}

function compactOrders(orders) {
  if (!Array.isArray(orders)) return [];
  const max = 280;
  const list = orders.slice(0, max);
  return list.map((o) => ({
    id: o.id,
    client: o.client ?? null,
    phone: o.phone ?? null,
    address: o.address ?? null,
    description: o.description ?? null,
    order_type: o.order_type ?? null,
    payment_status: o.payment_status ?? null,
    order_date: o.order_date ?? null,
    amount: o.amount ?? null,
    prepayment: o.prepayment ?? null,
    prepayment_to: o.prepayment_to ?? null,
    remaining_amount: o.remaining_amount ?? null,
    remaining_to: o.remaining_to ?? null,
    delivery: o.delivery ?? null,
    delivery_date: o.delivery_date ?? null,
    installation: Boolean(o.installation),
    installation_date: o.installation_date ?? null,
    area_m2: o.area_m2 ?? null,
  }));
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Empty model response");
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error("Model did not return JSON");
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  if (!OPENAI_API_KEY) {
    return res.status(503).json({
      message: "Голосовой ассистент не настроен: добавьте OPENAI_API_KEY в переменные окружения Vercel.",
      code: "not_configured",
    });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return res.status(400).json({ message: "Invalid JSON body" });
  }

  const message = String(body?.message || "").trim();
  if (!message) {
    return res.status(400).json({ message: "Пустое сообщение" });
  }

  const canCreateOrders = Boolean(body?.canCreateOrders);
  const orders = compactOrders(body?.orders);
  const history = normalizeHistory(body?.history);
  const nowIso = new Date().toISOString();

  const messages = [
    { role: "system", content: buildSystemPrompt({ canCreateOrders, nowIso }) },
    {
      role: "system",
      content: `SITE_ORDERS_JSON (${orders.length} шт., новые сверху по id):\n${JSON.stringify(orders)}`,
    },
    ...history,
    { role: "user", content: message.slice(0, 4000) },
  ];

  try {
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages,
      }),
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const detail = data?.error?.message || `OpenAI HTTP ${upstream.status}`;
      return res.status(502).json({ message: `Ошибка LLM: ${detail}` });
    }

    const content = data?.choices?.[0]?.message?.content;
    const parsed = extractJsonObject(content);
    const action = ["answer", "clarify", "propose_create_order"].includes(parsed?.action)
      ? parsed.action
      : "answer";
    const speak = String(parsed?.speak || "Не удалось сформировать ответ.").slice(0, 1500);

    let order = null;
    if (action === "propose_create_order" && canCreateOrders && parsed?.order && typeof parsed.order === "object") {
      order = parsed.order;
    }

    return res.status(200).json({ speak, action, order });
  } catch (e) {
    console.error("voice-assistant:", e);
    return res.status(500).json({ message: e?.message || "Ошибка голосового ассистента" });
  }
};
