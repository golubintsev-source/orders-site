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

const RU_COUNT_WORDS = {
  один: 1,
  одна: 1,
  одно: 1,
  одного: 1,
  два: 2,
  две: 2,
  двух: 2,
  три: 3,
  трех: 3,
  трёх: 3,
  четыре: 4,
  четырех: 4,
  четырёх: 4,
  пять: 5,
  пяти: 5,
  шесть: 6,
  шести: 6,
  семь: 7,
  семи: 7,
  восемь: 8,
  восьми: 8,
  девять: 9,
  девяти: 9,
  десять: 10,
  десяти: 10,
};

/** Служебные слова речи — не использовать как ключ поиска заказа. */
const MENTION_STOP_WORDS = new Set([
  "заказ",
  "заказа",
  "заказу",
  "заказе",
  "заказом",
  "заказы",
  "заказов",
  "заказам",
  "номер",
  "номера",
  "номеру",
  "номером",
  "клиент",
  "клиента",
  "клиенту",
  "клиентом",
  "клиенте",
  "адрес",
  "адреса",
  "адресу",
  "адресом",
  "адресе",
  "описание",
  "описания",
  "описанию",
  "описанием",
  "комментарий",
  "комментария",
  "статус",
  "статуса",
  "сумма",
  "суммы",
  "сумму",
  "дата",
  "даты",
  "дату",
  "доставка",
  "доставки",
  "монтаж",
  "монтажа",
  "оплата",
  "оплаты",
  "предоплата",
  "остаток",
  "тип",
  "типа",
  "скажи",
  "назови",
  "покажи",
  "найди",
  "подскажи",
  "расскажи",
  "какой",
  "какая",
  "какие",
  "какое",
  "каков",
  "какова",
  "сколько",
  "когда",
  "где",
  "кто",
  "что",
  "чей",
  "чья",
  "чье",
  "чьё",
  "про",
  "для",
  "это",
  "этот",
  "эта",
  "эти",
  "того",
  "той",
  "там",
  "тут",
  "есть",
  "был",
  "была",
  "было",
  "были",
  "будет",
  "можно",
  "нужно",
  "надо",
  "пожалуйста",
  "мне",
  "нас",
  "вас",
  "его",
  "ее",
  "её",
  "их",
  "наш",
  "ваш",
  "или",
  "либо",
  "также",
  "ещё",
  "еще",
  "уже",
  "только",
  "сейчас",
  "сегодня",
  "вчера",
  "завтра",
  "на",
  "по",
  "в",
  "во",
  "с",
  "со",
  "из",
  "к",
  "ко",
  "о",
  "об",
  "обо",
  "от",
  "до",
  "без",
  "при",
  "за",
  "под",
  "над",
  "и",
  "а",
  "но",
  "да",
  "нет",
  "ли",
  "же",
  "бы",
  "то",
  "не",
  "ни",
  "новый",
  "новая",
  "новое",
  "новые",
  "последний",
  "последняя",
  "последнее",
  "последние",
  "последнего",
  "создай",
  "создать",
  "добавь",
  "добавить",
  "оформи",
  "оформить",
]);

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

function normalizeRu(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRuCountToken(token) {
  if (!token) return null;
  if (/^\d+$/.test(token)) {
    const n = Number(token);
    return n >= 1 && n <= 20 ? n : null;
  }
  return RU_COUNT_WORDS[token] || null;
}

function formatOrderChip(order) {
  if (order?.id == null || order.id === "") return "";
  const letter = String(order.order_type || "")
    .trim()
    .charAt(0)
    .toLowerCase();
  const idNum = Number(order.id);
  if (Number.isFinite(idNum) && idNum < 0) {
    const tail = String(Math.abs(idNum) % 10000).padStart(4, "0");
    return letter ? `офл.${tail}_${letter}` : `офл.${tail}`;
  }
  const base = String(order.id).padStart(4, "0");
  return letter ? `${base}_${letter}` : base;
}

/**
 * Тексты полей, по которым голос ищет упомянутый заказ:
 * номер (id / chip / order_number), клиент, описание, адрес.
 */
function orderMentionFields(order) {
  const idStr = order?.id != null && order.id !== "" ? String(order.id) : "";
  const padded = idStr ? idStr.padStart(4, "0") : "";
  const chip = formatOrderChip(order);
  return {
    id: normalizeRu(idStr),
    padded: normalizeRu(padded),
    chip: normalizeRu(chip.replace(/[._]/g, " ")),
    order_number: normalizeRu(order?.order_number),
    client: normalizeRu(order?.client),
    description: normalizeRu(order?.description),
    address: normalizeRu(order?.address),
  };
}

function fieldContainsNeedle(fieldValue, needle) {
  if (!fieldValue || !needle) return false;
  if (fieldValue.includes(needle)) return true;
  // «0973» / «973» — номер без ведущих нулей
  if (/^\d+$/.test(needle) && /^\d+$/.test(fieldValue)) {
    return String(Number(fieldValue)) === String(Number(needle));
  }
  // Морфология без стеммера: «Иванова» ≈ «Иванов», «Петровой» ≈ «Петрова»
  if (/^\d+$/.test(needle) || needle.length < 3) return false;
  for (const word of fieldValue.split(" ")) {
    if (word.length < 3) continue;
    let shared = 0;
    const n = Math.min(word.length, needle.length);
    while (shared < n && word[shared] === needle[shared]) shared += 1;
    const minLen = Math.min(word.length, needle.length);
    const needShared = Math.max(4, Math.ceil(minLen * 0.7));
    if (shared >= needShared) return true;
  }
  return false;
}

function extractMentionNeedles(message) {
  const t = normalizeRu(message);
  if (!t) return [];

  const needles = [];
  const push = (raw, { priority = false } = {}) => {
    const n = normalizeRu(raw);
    if (!n || n.length < 2) return;
    if (MENTION_STOP_WORDS.has(n) && !/^\d+$/.test(n)) return;
    needles.push({ text: n, priority: Boolean(priority) || /^\d+$/.test(n) });
  };

  // Явные хвосты: «заказ Иванова», «по адресу Ленина 5», «клиент Петров», «описание кухня»
  const patterned = [
    /(?:^|\s)заказ(?:а|у|ом|е)?\s+(.+)$/u,
    /(?:^|\s)клиент(?:а|у|ом|е)?\s+(.+)$/u,
    /(?:^|\s)по\s+адресу\s+(.+)$/u,
    /(?:^|\s)адрес(?:а|у|ом|е)?\s+(.+)$/u,
    /(?:^|\s)описани(?:е|я|ю|ем)\s+(.+)$/u,
    /(?:^|\s)номер(?:а|у|ом)?\s+(.+)$/u,
  ];
  for (const re of patterned) {
    const m = t.match(re);
    if (!m?.[1]) continue;
    const tail = m[1]
      .split(/\s+/)
      .filter((w) => w && !MENTION_STOP_WORDS.has(w))
      .join(" ");
    if (tail) push(tail, { priority: true });
  }

  for (const m of t.matchAll(/\d+/g)) {
    push(m[0], { priority: true });
  }

  const tokens = t.split(" ").filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (MENTION_STOP_WORDS.has(tok) && !/^\d+$/.test(tok)) continue;
    if (tok.length >= 3 || /^\d+$/.test(tok)) push(tok);
    if (i + 1 < tokens.length) {
      const a = tokens[i];
      const b = tokens[i + 1];
      if (MENTION_STOP_WORDS.has(a) || MENTION_STOP_WORDS.has(b)) continue;
      if (a.length >= 2 && b.length >= 2) push(`${a} ${b}`);
    }
    if (i + 2 < tokens.length) {
      const a = tokens[i];
      const b = tokens[i + 1];
      const c = tokens[i + 2];
      if (MENTION_STOP_WORDS.has(a) || MENTION_STOP_WORDS.has(b) || MENTION_STOP_WORDS.has(c)) continue;
      if (a.length >= 2 && b.length >= 2 && c.length >= 2) push(`${a} ${b} ${c}`);
    }
  }

  // Уникальные, более длинные / приоритетные первыми
  const byText = new Map();
  for (const n of needles) {
    const prev = byText.get(n.text);
    if (!prev || (n.priority && !prev.priority) || n.text.length > prev.text.length) {
      byText.set(n.text, n);
    }
  }
  return [...byText.values()].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority ? -1 : 1;
    return b.text.length - a.text.length;
  });
}

/**
 * Поиск заказа по упоминанию в речи: номер, клиент (часть), описание (часть), адрес (часть).
 * @returns {{ order: object, score: number, matchedFields: string[] }[]}
 */
function findOrdersByMention(message, orders, { limit = 15 } = {}) {
  const needles = extractMentionNeedles(message);
  if (!needles.length || !Array.isArray(orders) || !orders.length) return [];

  const scored = [];
  for (const order of orders) {
    const fields = orderMentionFields(order);
    let score = 0;
    const matchedFields = new Set();

    for (const needle of needles) {
      for (const [name, value] of Object.entries(fields)) {
        if (!fieldContainsNeedle(value, needle.text)) continue;
        matchedFields.add(name === "padded" || name === "chip" ? "id" : name);
        const lenBoost = needle.text.length >= 6 ? 4 : needle.text.length >= 4 ? 3 : 2;
        const priorityBoost = needle.priority ? 3 : 0;
        const idBoost = name === "id" || name === "padded" || name === "chip" || name === "order_number" ? 12 : 0;
        // Полное совпадение поля (имя клиента целиком и т.п.)
        const exactBoost = value === needle.text ? 5 : 0;
        score += lenBoost + priorityBoost + idBoost + exactBoost;
      }
    }

    if (score > 0 && matchedFields.size > 0) {
      scored.push({ order, score, matchedFields: [...matchedFields] });
    }
  }

  scored.sort((a, b) => b.score - a.score || Number(b.order.id) - Number(a.order.id));
  // Отсекаем слабый шум относительно лучшего совпадения
  const best = scored[0]?.score || 0;
  const minKeep = Math.max(4, Math.floor(best * 0.45));
  return scored.filter((s) => s.score >= minKeep).slice(0, limit);
}

function messageLooksLikeOrderMention(message) {
  const t = normalizeRu(message);
  if (!t) return false;
  if (/\d/.test(t)) return true;
  return /(?:^|\s)(?:заказ(?:а|у|ом|е|ы|ов)?|клиент(?:а|у|ом|е)?|адрес(?:а|у|ом|е)?|описани(?:е|я|ю|ем)?|номер(?:а|у|ом)?|у)(?:\s|$)/u.test(
    t
  );
}

/**
 * Целые рубли для озвучки: «50 000».
 * @returns {string|null}
 */
function formatRubSpeak(val) {
  if (val == null || val === "") return null;
  const num = Number(val);
  if (!Number.isFinite(num)) return null;
  const rounded = Math.round(num);
  const abs = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return rounded < 0 ? `минус ${abs}` : abs;
}

/**
 * Какое поле спрашивают про «последние N»: id | amount | null (не наша зона).
 * Для адреса/клиента/статуса и т.п. возвращаем null — пусть отвечает LLM.
 */
function detectLastOrdersAskField(t) {
  // Сумма / стоимость / цена — до проверки «номеров», иначе «стоимость» перехватывается как id.
  if (
    /сумм|стоимост|цен[аеуы]|сколько\s+(?:стоит|вышло|составляет|денег)|на\s+какую\s+сумм|какая\s+цена/.test(
      t
    )
  ) {
    return "amount";
  }
  // Другие атрибуты — не подменять ответом «номер …».
  if (
    /адрес|клиент|телефон|статус|описан|доставк|монтаж|предоплат|остат|тип\s+заказ|дат[аеуы]|когда|куда|кому/.test(
      t
    )
  ) {
    return null;
  }
  return "id";
}

/**
 * Простые фактологические вопросы про «последние N заказов» отвечаем без LLM —
 * иначе gpt-4o-mini часто выдумывает id, игнорируя JSON.
 * Вопросы про сумму/стоимость тоже закрываем детерминированно (не номером заказа).
 */
function tryDeterministicLastOrdersAnswer(message, orders) {
  const t = normalizeRu(message);
  if (!t || !/заказ/.test(t)) return null;
  if (/созда|добав|оформ|запиш|завед/.test(t)) return null;
  if (!/последн|свеж/.test(t)) return null;

  const askField = detectLastOrdersAskField(t);
  if (askField == null) return null;

  const countAlt = Object.keys(RU_COUNT_WORDS).join("|");
  const countToken = `(?:\\d+|${countAlt})`;

  // «последний заказ» / «номер последнего» → 1
  let n = null;
  const mDigitAfter = t.match(new RegExp(`последн\\p{L}*\\s+(${countToken})\\s+заказ`, "u"));
  const mDigitBefore = t.match(new RegExp(`(${countToken})\\s+последн\\p{L}*\\s+заказ`, "u"));

  if (mDigitAfter) n = parseRuCountToken(mDigitAfter[1]);
  if (n == null && mDigitBefore) n = parseRuCountToken(mDigitBefore[1]);
  if (
    n == null &&
    (/последн(?:ий|его|ему|им|ем)\s+заказ/u.test(t) ||
      /номер\p{L}*\s+последн(?:ий|его|ему)/u.test(t) ||
      /(?:сумм|стоимост|цен[аеуы]).*последн|последн.*(?:сумм|стоимост|цен[аеуы])/u.test(t))
  ) {
    n = 1;
  }
  if (n == null) return null;
  n = Math.min(n, 20);

  if (!orders.length) {
    return {
      speak:
        askField === "amount"
          ? "В доступных данных сейчас нет заказов — не могу назвать сумму."
          : "В доступных данных сейчас нет заказов — не могу назвать номера.",
      action: "answer",
      order: null,
    };
  }

  const slice = orders.slice(0, n);
  const ids = slice.map((o) => o.id).filter((id) => id != null);
  if (!ids.length) {
    return {
      speak: "В данных нет номеров заказов.",
      action: "answer",
      order: null,
    };
  }

  if (askField === "amount") {
    if (slice.length === 1) {
      const order = slice[0];
      const rub = formatRubSpeak(order.amount);
      const speak =
        rub != null
          ? `Сумма последнего заказа номер ${order.id} — ${rub} рублей.`
          : `По последнему заказу номер ${order.id} сумма не указана.`;
      return { speak, action: "answer", order: null };
    }

    const parts = slice.map((o) => {
      const rub = formatRubSpeak(o.amount);
      return rub != null ? `${o.id} — ${rub} рублей` : `${o.id} — сумма не указана`;
    });
    return {
      speak: `Суммы последних ${slice.length} заказов: ${parts.join("; ")}.`,
      action: "answer",
      order: null,
    };
  }

  const idsText = ids.join(", ");
  const speak =
    ids.length === 1
      ? `Последний заказ — номер ${idsText}.`
      : `Последние ${ids.length} по номеру: ${idsText}.`;

  return { speak, action: "answer", order: null };
}

function buildOrdersFacts(orders) {
  const recentIds = orders.slice(0, 40).map((o) => o.id).filter((id) => id != null);
  return {
    count: orders.length,
    newest_id: recentIds[0] ?? null,
    recent_ids_newest_first: recentIds,
  };
}

function buildSystemPrompt({ canCreateOrders, nowIso, facts }) {
  const recentLine =
    facts.recent_ids_newest_first.length > 0
      ? facts.recent_ids_newest_first.join(", ")
      : "(пусто)";

  return `Ты голосовой ассистент сайта учёта заказов. Отвечай кратко, по-русски, фразами удобными для озвучки (1–3 предложения).

Сейчас: ${nowIso}

ЖЁСТКИЕ ПРАВИЛА ПО ДАННЫМ:
1) Единственный источник правды — блок SITE_ORDERS_FACTS и SITE_ORDERS_JSON ниже. Не опирайся на догадки и не «восстанавливай» номера из головы.
2) Номера заказов (поле id) копируй ТОЛЬКО из этих блоков. ЗАПРЕЩЕНО выдумывать, округлять, продолжать последовательности (типа 990, 989, 988) и менять цифры.
3) Если в истории диалога уже был неверный номер — исправь ответ по SITE_ORDERS_FACTS/JSON, а не по истории.
4) Номера заказов в speak пиши ЦИФРАМИ как в данных (например 973), не прописью.
5) «Последний заказ» / «последние N» = первые N элементов массива (он уже отсортирован: новые сверху по id).
6) Если данных не хватает или список пуст — скажи об этом честно, без вымышленных id и сумм.
7) Когда пользователь упоминает заказ, ищи его по полям: id (номер), order_number, client (клиент — можно часть имени), description (описание — можно часть текста), address (адрес — можно часть адреса). Частичное совпадение достаточно.
8) Если дан блок MATCHED_ORDERS_BY_MENTION — это кандидаты, найденные кодом по полям из п.7. Отвечай по ним в первую очередь. Если кандидат один — считай, что речь о нём. Если несколько — action "clarify", коротко перечисли номера и клиентов. Если блок пуст, а пользователь явно ссылался на заказ/клиента/адрес/описание — скажи, что такого заказа в данных нет (не выдумывай).

SITE_ORDERS_FACTS:
- заказов в срезе: ${facts.count}
- самый новый id: ${facts.newest_id ?? "нет"}
- последние id (новые слева, до 40 шт.): ${recentLine}

Поля заказа в JSON: id, order_number, client, phone, address, description, order_type, payment_status, order_date, amount, prepayment, prepayment_to, remaining_amount, remaining_to, delivery, delivery_date, installation, installation_date, area_m2.

Действия (поле action):
- "answer" — обычный ответ по данным (вопросы о сумме, адресе, клиенте, статусе, номерах и т.п.)
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
    id: o.id != null && o.id !== "" ? Number(o.id) || o.id : null,
    order_number: o.order_number ?? null,
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

/** Убрать дубликат текущего user-сообщения, если клиент уже положил его в history. */
function historyWithoutCurrentMessage(history, message) {
  if (!history.length) return history;
  const last = history[history.length - 1];
  if (last.role === "user" && last.content === message) {
    return history.slice(0, -1);
  }
  return history;
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
  const history = historyWithoutCurrentMessage(normalizeHistory(body?.history), message);
  const nowIso = new Date().toISOString();
  const facts = buildOrdersFacts(orders);

  const deterministic = tryDeterministicLastOrdersAnswer(message, orders);
  if (deterministic) {
    return res.status(200).json(deterministic);
  }

  const mentionMatches = messageLooksLikeOrderMention(message)
    ? findOrdersByMention(message, orders)
    : [];
  const matchedOrdersPayload = mentionMatches.map(({ order, score, matchedFields }) => ({
    id: order.id,
    order_number: order.order_number ?? null,
    client: order.client ?? null,
    address: order.address ?? null,
    description: order.description ?? null,
    order_type: order.order_type ?? null,
    payment_status: order.payment_status ?? null,
    amount: order.amount ?? null,
    matched_fields: matchedFields,
    match_score: score,
  }));

  const messages = [
    { role: "system", content: buildSystemPrompt({ canCreateOrders, nowIso, facts }) },
    {
      role: "system",
      content: `SITE_ORDERS_JSON (${orders.length} шт., новые сверху по id):\n${JSON.stringify(orders)}`,
    },
    {
      role: "system",
      content:
        matchedOrdersPayload.length > 0
          ? `MATCHED_ORDERS_BY_MENTION (${matchedOrdersPayload.length} шт., поиск по id/order_number/client/description/address, частичные совпадения):\n${JSON.stringify(matchedOrdersPayload)}`
          : `MATCHED_ORDERS_BY_MENTION: []${
              messageLooksLikeOrderMention(message)
                ? " — по номеру, клиенту, описанию и адресу совпадений не найдено."
                : ""
            }`,
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
        temperature: 0,
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

module.exports.findOrdersByMention = findOrdersByMention;
module.exports.extractMentionNeedles = extractMentionNeedles;
module.exports.messageLooksLikeOrderMention = messageLooksLikeOrderMention;
module.exports.normalizeRu = normalizeRu;
module.exports.tryDeterministicLastOrdersAnswer = tryDeterministicLastOrdersAnswer;
