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

/**
 * Номер как в таблице заказов: 4 цифры + «_» + первая буква типа (например 0112_О).
 * Для вставки в HTML оберните результат в escapeHtml.
 */
export function formatOrderIdTypeChip(orderId, orderType) {
  if (orderId == null || orderId === "") return "";
  const letter = (orderType || "").trim().charAt(0);
  const base = String(orderId).padStart(4, "0");
  return letter ? `${base}_${letter}` : base;
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
