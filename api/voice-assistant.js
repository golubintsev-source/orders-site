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
const CALC_FROM_PLACES = ["Вова", "Дима", "Касса", "Безнал", "Другое"];
const CALC_TO_PLACES = ["Вова", "Дима", "Касса", "Зарплата", "Покупка", "Списание", "Безнал", "Другое"];
const DEFAULT_EXPENSE_TO_PLACE = "Покупка";
const VOICE_ACTIONS = [
  "answer",
  "clarify",
  "propose_create_order",
  "propose_update_order",
  "propose_create_calculation",
];

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

const LAST_ORDER_FIELD_LABELS = {
  id: "номер",
  amount: "сумма",
  address: "адрес",
  client: "клиент",
  description: "описание",
  status: "статус",
  phone: "телефон",
};

/**
 * Какое поле спрашивают про «последние N»: id | amount | address | … | null (LLM).
 */
function detectLastOrdersAskField(t) {
  if (
    /сумм|стоимост|цен[аеуы]|сколько\s+(?:стоит|вышло|составляет|денег)|на\s+какую\s+сумм|какая\s+цена/.test(
      t
    )
  ) {
    return "amount";
  }
  if (/адрес/.test(t)) return "address";
  if (/клиент|заказчик/.test(t)) return "client";
  if (/описан|комментар/.test(t)) return "description";
  if (/статус/.test(t)) return "status";
  if (/телефон/.test(t)) return "phone";
  // Смешанные / сложные атрибуты — в LLM.
  if (/доставк|монтаж|предоплат|остат|тип\s+заказ|дат[аеуы]|когда|куда|кому/.test(t)) {
    return null;
  }
  return "id";
}

function readOrderAskValue(order, field) {
  if (field === "id") return order?.id != null ? String(order.id) : null;
  if (field === "amount") return formatRubSpeak(order?.amount);
  if (field === "status") {
    const s = String(order?.payment_status || "").trim();
    return s || null;
  }
  const raw = order?.[field === "description" ? "description" : field];
  const s = String(raw ?? "").trim();
  return s || null;
}

/**
 * Простые фактологические вопросы про «последние N заказов» отвечаем без LLM —
 * иначе gpt-4o-mini часто выдумывает id, игнорируя JSON.
 */
function tryDeterministicLastOrdersAnswer(message, orders) {
  const t = normalizeRu(message);
  if (!t || !/заказ/.test(t)) return null;
  // Создание / правка — не перехватывать.
  if (/созда|добав|оформ|запиш|завед|измени|отредактир|поменя|обнови|дополн|внеси|редактир/.test(t)) {
    return null;
  }
  if (!/последн|свеж/.test(t)) return null;

  const askField = detectLastOrdersAskField(t);
  if (askField == null) return null;

  const countAlt = Object.keys(RU_COUNT_WORDS).join("|");
  const countToken = `(?:\\d+|${countAlt})`;

  let n = null;
  const mDigitAfter = t.match(new RegExp(`последн\\p{L}*\\s+(${countToken})\\s+заказ`, "u"));
  const mDigitBefore = t.match(new RegExp(`(${countToken})\\s+последн\\p{L}*\\s+заказ`, "u"));

  if (mDigitAfter) n = parseRuCountToken(mDigitAfter[1]);
  if (n == null && mDigitBefore) n = parseRuCountToken(mDigitBefore[1]);
  if (
    n == null &&
    (/последн(?:ий|его|ему|им|ем)\s+заказ/u.test(t) ||
      /номер\p{L}*\s+последн(?:ий|его|ему)/u.test(t) ||
      /(?:сумм|стоимост|цен[аеуы]|адрес|клиент|описан|статус|телефон).*последн|последн.*(?:сумм|стоимост|цен[аеуы]|адрес|клиент|описан|статус|телефон)/u.test(
        t
      ))
  ) {
    n = 1;
  }
  if (n == null) return null;
  n = Math.min(n, 20);

  const label = LAST_ORDER_FIELD_LABELS[askField] || "данные";

  if (!orders.length) {
    return {
      speak: `В доступных данных сейчас нет заказов — не могу назвать ${label}.`,
      action: "answer",
      order: null,
      order_id: null,
    };
  }

  const slice = orders.slice(0, n);
  const ids = slice.map((o) => o.id).filter((id) => id != null);
  if (!ids.length) {
    return {
      speak: "В данных нет номеров заказов.",
      action: "answer",
      order: null,
      order_id: null,
    };
  }

  if (askField !== "id") {
    if (slice.length === 1) {
      const order = slice[0];
      const value = readOrderAskValue(order, askField);
      const speak =
        value != null
          ? askField === "amount"
            ? `Сумма последнего заказа номер ${order.id} — ${value} рублей.`
            : `По последнему заказу номер ${order.id} ${label} — ${value}.`
          : askField === "amount"
            ? `По последнему заказу номер ${order.id} сумма не указана.`
            : `По последнему заказу номер ${order.id} ${label} не указан.`;
      return { speak, action: "answer", order: null, order_id: null };
    }

    const parts = slice.map((o) => {
      const value = readOrderAskValue(o, askField);
      if (askField === "amount") {
        return value != null ? `${o.id} — ${value} рублей` : `${o.id} — сумма не указана`;
      }
      return value != null ? `${o.id} — ${value}` : `${o.id} — ${label} не указан`;
    });
    return {
      speak: `${label[0].toUpperCase()}${label.slice(1)} последних ${slice.length} заказов: ${parts.join("; ")}.`,
      action: "answer",
      order: null,
      order_id: null,
    };
  }

  const idsText = ids.join(", ");
  const speak =
    ids.length === 1
      ? `Последний заказ — номер ${idsText}.`
      : `Последние ${ids.length} по номеру: ${idsText}.`;

  return { speak, action: "answer", order: null, order_id: null };
}

function buildOrdersFacts(orders) {
  const recentIds = orders.slice(0, 40).map((o) => o.id).filter((id) => id != null);
  return {
    count: orders.length,
    newest_id: recentIds[0] ?? null,
    recent_ids_newest_first: recentIds,
  };
}

const VOICE_ORDER_DRAFT_KEYS = [
  "client",
  "phone",
  "address",
  "description",
  "order_type",
  "payment_status",
  "order_date",
  "amount",
  "prepayment",
  "prepayment_to",
  "remaining_amount",
  "remaining_to",
  "delivery",
  "delivery_date",
  "installation",
  "installation_date",
  "area_m2",
  "mosquito_nets",
  "construction_count",
];

function sanitizeOrderDraft(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  for (const key of VOICE_ORDER_DRAFT_KEYS) {
    if (!(key in raw)) continue;
    const v = raw[key];
    if (v == null || v === "") {
      out[key] = null;
      continue;
    }
    if (key === "installation") {
      out[key] = Boolean(v);
      continue;
    }
    if (
      key === "amount" ||
      key === "prepayment" ||
      key === "remaining_amount" ||
      key === "area_m2" ||
      key === "mosquito_nets" ||
      key === "construction_count"
    ) {
      const n = Number(v);
      out[key] = Number.isFinite(n) ? Math.round(n) : null;
      continue;
    }
    out[key] = String(v).trim() || null;
  }
  return out;
}

function missingCreateRequired(draft) {
  const missing = [];
  if (!String(draft?.client || "").trim()) missing.push("клиент");
  if (!String(draft?.payment_status || "").trim()) missing.push("статус");
  return missing;
}

function sanitizeCalculationDraft(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  if ("amount" in raw) {
    const n = Number(raw.amount);
    out.amount = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }
  const desc = raw.description ?? raw.comment ?? null;
  if (desc != null && desc !== "") {
    out.description = String(desc).trim() || null;
  } else if ("description" in raw || "comment" in raw) {
    out.description = null;
  }
  if ("to_place" in raw) {
    const to = raw.to_place == null || raw.to_place === "" ? null : String(raw.to_place).trim();
    out.to_place = to && CALC_TO_PLACES.includes(to) ? to : to ? null : null;
  }
  if ("from_place" in raw) {
    const from = raw.from_place == null || raw.from_place === "" ? null : String(raw.from_place).trim();
    out.from_place = from && CALC_FROM_PLACES.includes(from) ? from : null;
  }
  return out;
}

function missingCalculationRequired(draft) {
  const missing = [];
  if (draft?.amount == null || !(Number(draft.amount) > 0)) missing.push("сумму");
  if (!String(draft?.description || "").trim()) missing.push("на что потрачены средства");
  return missing;
}

function listCalculationParamsForSpeak(draft) {
  if (!draft) return "";
  const parts = [];
  if (draft.amount != null) parts.push(`сумма: ${formatRubSpeak(draft.amount)} рублей`);
  if (draft.description) parts.push(`на что: ${draft.description}`);
  if (draft.to_place) parts.push(`куда: ${draft.to_place}`);
  if (draft.from_place) parts.push(`откуда: ${draft.from_place}`);
  return parts.join("; ");
}

/**
 * Детерминированный разбор фраз вида «внеси расход 5000 на бензин», «потратил 1500 за материалы».
 * @returns {null | { speak: string, action: string, order: null, order_id: null, calculation: object }}
 */
function tryDeterministicExpenseProposal(message) {
  const t = normalizeRu(message);
  if (!t) return null;

  const expenseIntent =
    /(?:внеси|добавь|запиши|создай|внести|добавить|записать)\s+(?:расход|трату|в расход|в расходы|в расчеты|в расчёты)/.test(
      t
    ) ||
    /(?:расход|трату)\s+\d/.test(t) ||
    /(?:потратил|потратила|потратили|израсходовал|израсходовала)\s/.test(t) ||
    /(?:новый\s+)?расход\s*[:\-]?\s*\d/.test(t);

  if (!expenseIntent) return null;

  // Не перехватывать явное создание/правку заказа.
  if (
    /(?:создай|создать|новый|оформи|измени|изменить|отредактируй)\s+заказ/.test(t) ||
    /(?:заказ\s+(?:для|клиент)|статус\s+заказа)/.test(t)
  ) {
    return null;
  }

  let amount = null;
  const amountMatch = t.match(
    /(?:на\s+сумму\s+|сумм(?:а|у|ой)\s+|стоимость\s+)?(\d[\d\s]{0,12})\s*(?:руб(?:лей|ля|ль)?|р\.?)?(?:\s|$)/
  );
  if (amountMatch) {
    const n = Number(String(amountMatch[1]).replace(/\s+/g, ""));
    if (Number.isFinite(n) && n > 0) amount = Math.round(n);
  }
  if (amount == null) {
    const loose = t.match(/\b(\d{2,})\b/);
    if (loose) {
      const n = Number(loose[1]);
      if (Number.isFinite(n) && n > 0) amount = Math.round(n);
    }
  }

  let description = null;
  const descPatterns = [
    /(?:^|\s)(?:на что|описание|комментарий)\s+(.+)$/u,
    /(?:^|\s)на\s+(.+)$/u,
    /(?:^|\s)за\s+(.+)$/u,
  ];
  for (const re of descPatterns) {
    const m = t.match(re);
    if (!m) continue;
    let raw = String(m[1] || "")
      .replace(/(?:^|\s)\d[\d\s]*(?:\s*(?:руб(?:лей|ля|ль)?|р\.?))?(?=\s|$)/g, " ")
      .replace(
        /(?:^|\s)(?:рублей|рубля|рубль|пожалуйста|верно|подтверди|добавь|внеси|запиши)(?=\s|$)/g,
        " "
      )
      .replace(/\s+/g, " ")
      .trim();
    // Убрать ведущие «сумму N» и служебные хвосты
    raw = raw
      .replace(/^(?:сумм(?:а|у|ой)\s*)?/u, "")
      .replace(/\s+/g, " ")
      .trim();
    // Не принимать «на сумму …» без реального описания
    if (/^сумм/.test(raw)) continue;
    if (raw.length >= 2 && !/^\d+$/.test(raw)) {
      description = raw;
      break;
    }
  }

  const calculation = {
    amount: amount > 0 ? amount : null,
    description: description || null,
    to_place: DEFAULT_EXPENSE_TO_PLACE,
    from_place: null,
  };
  const missing = missingCalculationRequired(calculation);
  if (missing.length) {
    return {
      speak: `Чтобы записать расход, укажите ${missing.join(" и ")}.`,
      action: "clarify",
      order: null,
      order_id: null,
      calculation,
    };
  }
  const listed = listCalculationParamsForSpeak(calculation);
  return {
    speak: `Записать расход: ${listed}. Верно?`,
    action: "propose_create_calculation",
    order: null,
    order_id: null,
    calculation,
  };
}

function listDraftParamsForSpeak(draft) {
  if (!draft) return "";
  const parts = [];
  const push = (label, value) => {
    if (value == null || value === "") return;
    parts.push(`${label}: ${value}`);
  };
  push("клиент", draft.client);
  push("статус", draft.payment_status);
  push("телефон", draft.phone);
  push("адрес", draft.address);
  push("описание", draft.description);
  push("тип", draft.order_type);
  if (draft.amount != null) push("сумма", `${formatRubSpeak(draft.amount)} рублей`);
  if (draft.prepayment != null) push("предоплата", `${formatRubSpeak(draft.prepayment)} рублей`);
  push("кому предоплата", draft.prepayment_to);
  if (draft.remaining_amount != null) {
    push("остаток", `${formatRubSpeak(draft.remaining_amount)} рублей`);
  }
  push("кому остаток", draft.remaining_to);
  push("доставка", draft.delivery);
  push("дата доставки", draft.delivery_date);
  if (draft.installation) push("монтаж", "да");
  push("дата монтажа", draft.installation_date);
  return parts.join("; ");
}

function patchHasChanges(patch) {
  if (!patch || typeof patch !== "object") return false;
  return Object.keys(patch).some((k) => {
    if (!VOICE_ORDER_DRAFT_KEYS.includes(k)) return false;
    const v = patch[k];
    return v != null && v !== "";
  });
}

/**
 * Патч правки: убрать пустые client/status (модель часто заполняет весь объект null-ами).
 * Остальные null оставляем — ими можно очистить необязательное поле.
 */
function normalizeUpdatePatch(patch) {
  if (!patch || typeof patch !== "object") return null;
  const out = { ...patch };
  if (out.client == null || out.client === "") delete out.client;
  if (out.payment_status == null || out.payment_status === "") delete out.payment_status;
  return out;
}

function buildSystemPrompt({ canCreateOrders, canCreateCalculations, nowIso, facts }) {
  const recentLine =
    facts.recent_ids_newest_first.length > 0
      ? facts.recent_ids_newest_first.join(", ")
      : "(пусто)";

  const mutateLine = canCreateOrders
    ? "Создание и редактирование заказов РАЗРЕШЕНЫ."
    : "Создание и редактирование заказов ЗАПРЕЩЕНЫ для этой роли — только ответы по данным (сценарий 1) и при доступе — расходы (сценарий 4).";
  const calcLine = canCreateCalculations
    ? "Запись расходов в расчёты РАЗРЕШЕНА."
    : "Запись расходов в расчёты ЗАПРЕЩЕНА для этой роли.";

  return `Ты голосовой ассистент сайта учёта заказов и расчётов. Отвечай кратко, по-русски, фразами удобными для озвучки (1–3 предложения).

Сейчас: ${nowIso}
${mutateLine}
${calcLine}

ЧЕТЫРЕ ОСНОВНЫХ СЦЕНАРИЯ (выбери один):

=== СЦЕНАРИЙ 1. ЗАПРОС ИНФОРМАЦИИ ===
Пользователь спрашивает данные по одному или нескольким заказам: сумма/стоимость, адрес, клиент, описание, статус, телефон, тип, даты, предоплата и т.п.
- action: "answer" (или "clarify", если непонятно какой заказ).
- Ищи заказ по id, order_number, client, description, address (частичное совпадение ок).
- Можно отвечать сразу по нескольким заказам.
- order = null, order_id = null, calculation = null.

=== СЦЕНАРИЙ 2. СОЗДАНИЕ НОВОГО ЗАКАЗА ===
Пользователь хочет создать заказ (создай / новый заказ / оформи / добавь заявку…).
Обязательные поля: client (клиент) и payment_status (статус). Остальное — по желанию.
- Если не хватает клиента и/или статуса → action "clarify", спроси недостающее. Можно вернуть частичный order с уже известными полями.
- Когда обязательные поля есть → action "propose_create_order", заполни order всеми извлечёнными полями.
- В speak ПЕРЕД подтверждением ПЕРЕЧИСЛИ все параметры заказа (клиент, статус и всё остальное, что указано). Спроси подтверждение («создать?» / «верно?»).
- Создание на сайте подтвердит пользователь кнопкой или голосом «да»/«нет». Не утверждай, что заказ уже создан.
- calculation = null.

=== СЦЕНАРИЙ 3. РЕДАКТИРОВАНИЕ ЗАКАЗА ===
Пользователь хочет изменить / отредактировать / дополнить / обновить существующий заказ (поля: адрес, сумма, статус, клиент, описание…).
- Найди заказ по номеру, клиенту, адресу или описанию (см. MATCHED_ORDERS_BY_MENTION).
- Если подходит несколько → action "clarify", перечисли номера и клиентов, попроси выбрать.
- Если заказ один, но не сказано что менять → action "clarify", спроси какие поля добавить или изменить.
- Когда заказ известен и есть поля для изменения → action "propose_update_order":
  order_id = id заказа, order = ТОЛЬКО изменяемые поля (патч).
- В speak перечисли номер заказа и что именно изменится (старое→новое, если известно). Спроси подтверждение.
- После слияния клиент и статус не должны стать пустыми. Если патч обнуляет обязательное — clarify.
- calculation = null.

=== СЦЕНАРИЙ 4. ВНЕСЕНИЕ РАСХОДА В РАСЧЁТЫ ===
Пользователь хочет записать расход / трату / покупку в раздел «Расчеты» (внеси расход, добавь расход, потратил, запиши трату…).
Обязательные поля calculation: amount (сумма в целых рублях) и description (на что потрачены средства).
- Откуда (from_place) на сайте подставится автоматически от вошедшего пользователя — НЕ спрашивай «от кого» и не заполняй from_place (оставь null).
- Куда (to_place): по умолчанию «Покупка». Если явно сказано зарплата / списание / касса / безнал / другое — поставь одно из: ${CALC_TO_PLACES.join(" | ")}.
- Если не хватает суммы и/или описания → action "clarify", спроси недостающее. Можно вернуть частичный calculation.
- Когда сумма и описание есть → action "propose_create_calculation", заполни calculation.
- В speak перечисли сумму и на что потрачено (и куда, если не Покупка). Спроси подтверждение («записать?» / «верно?»).
- Не утверждай, что расход уже записан. order = null, order_id = null.
- Это НЕ создание заказа: фразы про «потратил / расход / на бензин» без «заказ» → сценарий 4, не 2.

ЖЁСТКИЕ ПРАВИЛА ПО ДАННЫМ:
1) Единственный источник правды по заказам — SITE_ORDERS_FACTS и SITE_ORDERS_JSON. Не выдумывай номера и суммы заказов.
2) id копируй ТОЛЬКО из этих блоков / MATCHED_ORDERS_BY_MENTION.
3) Если в истории был неверный номер — исправь по фактам, не по истории.
4) Номера в speak — ЦИФРАМИ (973), не прописью.
5) «Последний заказ» / «последние N» = первые N элементов массива (новые сверху по id).
6) Пустые данные — скажи честно.
7) Поиск упоминания: id, order_number, client, description, address; частичное совпадение достаточно.
8) MATCHED_ORDERS_BY_MENTION — приоритетные кандидаты. 1 шт. → это тот заказ; несколько → clarify; пусто при явном упоминании → «не найден».
9) Для сценария 4 сумму расхода бери из речи пользователя (не из заказов), если он её назвал.

SITE_ORDERS_FACTS:
- заказов в срезе: ${facts.count}
- самый новый id: ${facts.newest_id ?? "нет"}
- последние id (новые слева, до 40 шт.): ${recentLine}

Поля заказа в JSON: id, order_number, client, phone, address, description, order_type, payment_status, order_date, amount, prepayment, prepayment_to, remaining_amount, remaining_to, delivery, delivery_date, installation, installation_date, area_m2.

Допустимые значения:
- order_type: ${ORDER_TYPES.join(" | ")} или null
- payment_status: ${PAYMENT_STATUSES.join(" | ")}
- prepayment_to / remaining_to: ${MONEY_TO.join(" | ")} или null
- delivery: ${DELIVERY.join(" | ")} или null
- amount, prepayment, remaining_amount — целые рубли или null
- installation — boolean
- даты — ISO YYYY-MM-DD или null
- calculation.to_place: ${CALC_TO_PLACES.join(" | ")} или null
- calculation.amount — целые рубли > 0

Верни ТОЛЬКО JSON-объект без markdown:
{
  "speak": "текст для озвучки",
  "action": "answer" | "clarify" | "propose_create_order" | "propose_update_order" | "propose_create_calculation",
  "order_id": number|null,
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
  },
  "calculation": null | {
    "amount": number|null,
    "description": string|null,
    "to_place": string|null,
    "from_place": null
  }
}`;
}

/**
 * Постобработка ответа модели: обязательные поля, права, order_id.
 */
function finalizeAssistantPayload(parsed, { canCreateOrders, canCreateCalculations, orders, mentionMatches }) {
  let action = VOICE_ACTIONS.includes(parsed?.action) ? parsed.action : "answer";
  let speak = String(parsed?.speak || "Не удалось сформировать ответ.").slice(0, 1500);
  let order = sanitizeOrderDraft(parsed?.order);
  let calculation = sanitizeCalculationDraft(parsed?.calculation);
  let orderId =
    parsed?.order_id != null && parsed.order_id !== ""
      ? Number(parsed.order_id) || parsed.order_id
      : null;

  if (action === "propose_create_calculation") {
    if (!canCreateCalculations) {
      return {
        speak: "Запись расходов в расчёты недоступна для вашей роли.",
        action: "answer",
        order: null,
        order_id: null,
        calculation: null,
      };
    }
    if (!calculation) calculation = {};
    if (!calculation.to_place) calculation.to_place = DEFAULT_EXPENSE_TO_PLACE;
    calculation.from_place = null;
    const missing = missingCalculationRequired(calculation);
    if (missing.length) {
      return {
        speak:
          speak && /сумм|на что|потрат|укаж|нужн/i.test(speak)
            ? speak
            : `Чтобы записать расход, укажите ${missing.join(" и ")}.`,
        action: "clarify",
        order: null,
        order_id: null,
        calculation,
      };
    }
    const listed = listCalculationParamsForSpeak(calculation);
    if (listed && !/подтверд|записать\?|верно\?|добавить\?/i.test(speak)) {
      speak = `Записать расход: ${listed}. Верно?`;
    } else if (listed && calculation.amount != null && !speak.includes(String(calculation.amount))) {
      speak = `${speak} Параметры: ${listed}.`;
    }
    return {
      speak,
      action: "propose_create_calculation",
      order: null,
      order_id: null,
      calculation,
    };
  }

  if (action === "propose_create_order") {
    if (!canCreateOrders) {
      return {
        speak: "Создание заказов недоступно для вашей роли.",
        action: "answer",
        order: null,
        order_id: null,
        calculation: null,
      };
    }
    if (!order) order = {};
    const missing = missingCreateRequired(order);
    if (missing.length) {
      return {
        speak:
          speak && /клиент|статус|укаж|нужн/i.test(speak)
            ? speak
            : `Чтобы создать заказ, укажите обязательные данные: ${missing.join(" и ")}.`,
        action: "clarify",
        order,
        order_id: null,
        calculation: null,
      };
    }
    if (order.payment_status && !PAYMENT_STATUSES.includes(order.payment_status)) {
      return {
        speak: `Статус «${order.payment_status}» не из списка. Назовите один из допустимых статусов.`,
        action: "clarify",
        order,
        order_id: null,
        calculation: null,
      };
    }
    const listed = listDraftParamsForSpeak(order);
    if (listed && !/подтверд|создать\?|верно\?/i.test(speak)) {
      speak = `Параметры заказа: ${listed}. Создать заказ?`;
    } else if (listed && !speak.includes(String(order.client || ""))) {
      speak = `${speak} Параметры: ${listed}.`;
    }
    return { speak, action: "propose_create_order", order, order_id: null, calculation: null };
  }

  if (action === "propose_update_order") {
    if (!canCreateOrders) {
      return {
        speak: "Редактирование заказов недоступно для вашей роли.",
        action: "answer",
        order: null,
        order_id: null,
        calculation: null,
      };
    }
    if (orderId == null && mentionMatches.length === 1) {
      orderId = mentionMatches[0].order.id;
    }
    if (orderId == null && mentionMatches.length > 1) {
      const list = mentionMatches
        .slice(0, 8)
        .map((m) => `${m.order.id}${m.order.client ? ` (${m.order.client})` : ""}`)
        .join(", ");
      return {
        speak: `Подходит несколько заказов: ${list}. Назовите номер нужного.`,
        action: "clarify",
        order: null,
        order_id: null,
        calculation: null,
      };
    }
    if (orderId == null) {
      return {
        speak: "Не понял, какой заказ изменить. Назовите номер, клиента, адрес или описание.",
        action: "clarify",
        order: null,
        order_id: null,
        calculation: null,
      };
    }
    const exists = orders.some((o) => Number(o.id) === Number(orderId) || o.id === orderId);
    if (!exists) {
      return {
        speak: `Заказ номер ${orderId} в доступных данных не найден.`,
        action: "answer",
        order: null,
        order_id: null,
        calculation: null,
      };
    }
    order = normalizeUpdatePatch(order);
    if (!patchHasChanges(order)) {
      return {
        speak: `Заказ ${orderId} найден. Что добавить или изменить?`,
        action: "clarify",
        order: null,
        order_id: orderId,
        calculation: null,
      };
    }
    if (
      order.payment_status != null &&
      order.payment_status !== "" &&
      !PAYMENT_STATUSES.includes(order.payment_status)
    ) {
      return {
        speak: `Статус «${order.payment_status}» не из списка. Назовите допустимый статус.`,
        action: "clarify",
        order,
        order_id: orderId,
        calculation: null,
      };
    }
    if (!/подтверд|изменить\?|сохранить\?|верно\?/i.test(speak)) {
      const listed = listDraftParamsForSpeak(order);
      speak = `Изменить заказ ${orderId}: ${listed}. Сохранить изменения?`;
    }
    return { speak, action: "propose_update_order", order, order_id: orderId, calculation: null };
  }

  // clarify с частичным черновиком расхода
  if (action === "clarify" && calculation && missingCalculationRequired(calculation).length) {
    return {
      speak,
      action: "clarify",
      order: null,
      order_id: null,
      calculation,
    };
  }

  // clarify с частичным черновиком создания — оставляем order для карточки
  if (action === "clarify" && order && !patchHasChanges(order) && !missingCreateRequired(order).length) {
    // пустой объект не нужен
    order = null;
  }

  return {
    speak,
    action,
    order: action === "clarify" ? order : null,
    order_id: orderId,
    calculation: action === "clarify" ? calculation : null,
  };
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
  const canCreateCalculations = Boolean(body?.canCreateCalculations);
  const orders = compactOrders(body?.orders);
  const history = historyWithoutCurrentMessage(normalizeHistory(body?.history), message);
  const nowIso = new Date().toISOString();
  const facts = buildOrdersFacts(orders);

  const deterministicExpense = canCreateCalculations ? tryDeterministicExpenseProposal(message) : null;
  if (deterministicExpense) {
    const finalizedExpense = finalizeAssistantPayload(deterministicExpense, {
      canCreateOrders,
      canCreateCalculations,
      orders,
      mentionMatches: [],
    });
    return res.status(200).json(finalizedExpense);
  }

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
    phone: order.phone ?? null,
    address: order.address ?? null,
    description: order.description ?? null,
    order_type: order.order_type ?? null,
    payment_status: order.payment_status ?? null,
    amount: order.amount ?? null,
    prepayment: order.prepayment ?? null,
    remaining_amount: order.remaining_amount ?? null,
    delivery: order.delivery ?? null,
    delivery_date: order.delivery_date ?? null,
    installation: Boolean(order.installation),
    matched_fields: matchedFields,
    match_score: score,
  }));

  const messages = [
    {
      role: "system",
      content: buildSystemPrompt({ canCreateOrders, canCreateCalculations, nowIso, facts }),
    },
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
    const finalized = finalizeAssistantPayload(parsed, {
      canCreateOrders,
      canCreateCalculations,
      orders,
      mentionMatches,
    });

    return res.status(200).json(finalized);
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
module.exports.tryDeterministicExpenseProposal = tryDeterministicExpenseProposal;
module.exports.finalizeAssistantPayload = finalizeAssistantPayload;
module.exports.missingCreateRequired = missingCreateRequired;
module.exports.missingCalculationRequired = missingCalculationRequired;
module.exports.sanitizeOrderDraft = sanitizeOrderDraft;
module.exports.sanitizeCalculationDraft = sanitizeCalculationDraft;
module.exports.normalizeUpdatePatch = normalizeUpdatePatch;
