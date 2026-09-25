export const AUTOMATIC_CALCULATION_COMMENT_PREFIXES = [
  "[AUTO_ORDER_DELTA]",
  "[AUTO_EXCESS_DELTA]",
];

export const SALARY_COMMENT_TERMS = ["ЗП", "зарплата", "аванс", "премия", "бонус"];

const RUSSIAN_MONTH_BY_FORM = new Map(
  [
    [0, ["январь", "января", "январе"]],
    [1, ["февраль", "февраля", "феврале"]],
    [2, ["март", "марта", "марте"]],
    [3, ["апрель", "апреля", "апреле"]],
    [4, ["май", "мая", "мае"]],
    [5, ["июнь", "июня", "июне"]],
    [6, ["июль", "июля", "июле"]],
    [7, ["август", "августа", "августе"]],
    [8, ["сентябрь", "сентября", "сентябре"]],
    [9, ["октябрь", "октября", "октябре"]],
    [10, ["ноябрь", "ноября", "ноябре"]],
    [11, ["декабрь", "декабря", "декабре"]],
  ].flatMap(([monthIndex, forms]) => forms.map((form) => [form, monthIndex])),
);

/** Зарплата — ручная строка с одним из зарплатных обозначений в комментарии. */
export function isSalaryCalculationRow(row) {
  if (!row || row.deleted_at != null) return false;
  const comment = String(row.comment ?? "");
  if (AUTOMATIC_CALCULATION_COMMENT_PREFIXES.some((prefix) => comment.startsWith(prefix))) {
    return false;
  }
  const normalizedComment = comment.toLocaleLowerCase("ru-RU");
  return SALARY_COMMENT_TERMS.some((term) =>
    normalizedComment.includes(term.toLocaleLowerCase("ru-RU")),
  );
}

function findCommentMonth(comment) {
  const normalized = String(comment ?? "").toLocaleLowerCase("ru-RU");
  for (const match of normalized.matchAll(/[а-яё]+/g)) {
    const monthIndex = RUSSIAN_MONTH_BY_FORM.get(match[0]);
    if (monthIndex != null) {
      return { monthIndex, start: match.index, end: match.index + match[0].length };
    }
  }
  return null;
}

function findYearNearCommentMonth(comment, monthMatch) {
  let nearest = null;
  for (const match of String(comment ?? "").matchAll(/(?:19|20)\d{2}/g)) {
    const start = match.index;
    const end = start + match[0].length;
    const distance =
      end < monthMatch.start
        ? monthMatch.start - end
        : start > monthMatch.end
          ? start - monthMatch.end
          : 0;
    if (distance > 20) continue;
    if (!nearest || distance < nearest.distance) {
      nearest = { year: Number(match[0]), distance };
    }
  }
  return nearest?.year ?? null;
}

function closestYearForMonth(date, monthIndex) {
  const sourceMonthNumber = date.getFullYear() * 12 + date.getMonth();
  const candidates = [date.getFullYear() - 1, date.getFullYear(), date.getFullYear() + 1];
  candidates.sort((a, b) => {
    const aNumber = a * 12 + monthIndex;
    const bNumber = b * 12 + monthIndex;
    const distanceDiff =
      Math.abs(aNumber - sourceMonthNumber) - Math.abs(bNumber - sourceMonthNumber);
    if (distanceDiff) return distanceDiff;
    // При равном расстоянии выплата чаще относится к уже прошедшему месяцу.
    return aNumber <= sourceMonthNumber ? -1 : 1;
  });
  return candidates[0];
}

export function salaryMonthKey(createdAt, comment = "") {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  const commentMonth = findCommentMonth(comment);
  const monthIndex = commentMonth?.monthIndex ?? date.getMonth();
  const explicitYear = commentMonth ? findYearNearCommentMonth(comment, commentMonth) : null;
  const year =
    explicitYear ??
    (commentMonth ? closestYearForMonth(date, commentMonth.monthIndex) : date.getFullYear());
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

/** Новые месяцы и новые выплаты идут первыми. */
export function groupSalaryRowsByMonth(rows) {
  const byMonth = new Map();
  for (const row of rows || []) {
    if (!isSalaryCalculationRow(row)) continue;
    const monthKey = salaryMonthKey(row.created_at, row.comment);
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
