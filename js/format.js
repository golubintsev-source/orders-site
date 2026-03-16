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
