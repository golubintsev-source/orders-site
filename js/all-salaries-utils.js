export const AUTOMATIC_CALCULATION_COMMENT_PREFIXES = [
  "[AUTO_ORDER_DELTA]",
  "[AUTO_EXCESS_DELTA]",
];

/** Зарплата — ручная строка расчётов, в комментарии которой встречается «ЗП». */
export function isSalaryCalculationRow(row) {
  if (!row || row.deleted_at != null) return false;
  const comment = String(row.comment ?? "");
  if (AUTOMATIC_CALCULATION_COMMENT_PREFIXES.some((prefix) => comment.startsWith(prefix))) {
    return false;
  }
  return /зп/i.test(comment);
}

export function salaryMonthKey(createdAt) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Новые месяцы и новые выплаты идут первыми. */
export function groupSalaryRowsByMonth(rows) {
  const byMonth = new Map();
  for (const row of rows || []) {
    if (!isSalaryCalculationRow(row)) continue;
    const monthKey = salaryMonthKey(row.created_at);
    const amount = Number(row.amount);
    if (!monthKey || !Number.isFinite(amount)) continue;
    let group = byMonth.get(monthKey);
    if (!group) {
      group = { monthKey, total: 0, rows: [] };
      byMonth.set(monthKey, group);
    }
    group.total += amount;
    group.rows.push(row);
  }

  return [...byMonth.values()]
    .sort((a, b) => b.monthKey.localeCompare(a.monthKey))
    .map((group) => ({
      ...group,
      rows: group.rows
        .slice()
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    }));
}
