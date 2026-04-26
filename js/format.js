/** Сообщение при вводе дробной части или недопустимых символов в суммах (рубли). */
export const MSG_SUM_INTEGER_ONLY =
  "Сумма — только целые рубли, без копеек. Не используйте точку, запятую и другие символы.";

/**
 * Разбор суммы в рублях: только целые, без десятичной части.
 * Пробелы и неразрывные пробелы допускаются как разделители тысяч.
 * @returns {{ ok: true, value: number | null, invalidFormat: false } | { ok: false, value: null, invalidFormat: true }}
 */
export function tryParseRublesInteger(raw, { allowSign = false } = {}) {
  const s0 = String(raw ?? "").trim();
  if (!s0) return { ok: true, value: null, invalidFormat: false };
  const compact = s0.replace(/[\s\u00A0\u202F]/g, "");
  const re = allowSign ? /^[+-]?\d+$/ : /^\d+$/;
  if (!re.test(compact)) return { ok: false, value: null, invalidFormat: true };
  const n = parseInt(compact, 10);
  return { ok: true, value: Number.isFinite(n) ? n : null, invalidFormat: false };
}

/**
 * Подсветка поля суммы: неверный формат — класс и подсказка.
 */
export function refreshRublesIntegerInputState(el, raw, { allowSign = false } = {}) {
  if (!el) return;
  const s = String(raw ?? "").trim();
  if (!s) {
    el.classList.remove("sum-input-invalid");
    el.removeAttribute("title");
    el.removeAttribute("aria-invalid");
    return;
  }
  const r = tryParseRublesInteger(raw, { allowSign });
  if (r.invalidFormat) {
    el.classList.add("sum-input-invalid");
    el.title = MSG_SUM_INTEGER_ONLY;
    el.setAttribute("aria-invalid", "true");
  } else {
    el.classList.remove("sum-input-invalid");
    el.removeAttribute("title");
    el.removeAttribute("aria-invalid");
  }
}

/**
 * Форматирует число с пробелами между тысячами и миллионами (1 234 567,89).
 * Для отображения сумм в таблицах и интерфейсе.
 */
export function formatAmount(val) {
  if (val == null || val === "") return "";
  const num = Number(val);
  if (Number.isNaN(num)) return String(val);
  const str = String(num);
  const [intPart, decPart] = str.split(".");
  const withSpaces = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00A0");
  return decPart !== undefined ? `${withSpaces},${decPart}` : withSpaces;
}

/** Целые рубли без дробной части (страница «Баланс»). */
export function formatAmountWholeRubles(val) {
  if (val == null || val === "") return "";
  const num = Number(val);
  if (Number.isNaN(num)) return String(val);
  return formatAmount(Math.round(num));
}

/**
 * Номер как в таблице заказов: 4 цифры + «_» + первая буква типа (например 0112_О).
 * Для вставки в HTML оберните результат в escapeHtml.
 */
export function formatOrderIdTypeChip(orderId, orderType) {
  if (orderId == null || orderId === "") return "";
  const letter = (orderType || "").trim().charAt(0);
  if (typeof orderId === "number" && orderId < 0) {
    const tail = String(Math.abs(orderId) % 10000).padStart(4, "0");
    return letter ? `офл.${tail}_${letter}` : `офл.${tail}`;
  }
  const base = String(orderId).padStart(4, "0");
  return letter ? `${base}_${letter}` : base;
}

/** Короткая дата для таблиц: «13 апр» (как в списке заказов). */
export function formatDateShortRU(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return "";
    const months = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
    return `${d.getDate()} ${months[d.getMonth()]}`;
  } catch {
    return "";
  }
}

/** Дата и время: «13 апр 11:10», «4 мар 7:45» (локальное время). */
export function formatTaskDateRu(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const months = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const h = d.getHours();
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()} ${months[d.getMonth()]} ${h}:${min}`;
}

/** Автор в таблицах: не более 5 символов, далее ... */
export function formatTaskAuthorShort(raw) {
  if (raw == null || raw === "") return "—";
  const s = String(raw).trim();
  if (s.length <= 5) return s;
  return `${s.slice(0, 5)}...`;
}
