export const DEBT_STATUSES = [
  "Клиент согласен",
  "Производство",
  "Товар передан заказчику",
  "Монтаж выполнен",
];

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function todayYmd(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

export function addCalendarMonths(ymd, deltaMonths) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  if (!y || !m || !d) return null;
  const monthIndex = m - 1 + deltaMonths;
  const year = y + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const day = Math.min(d, lastDay);
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

function orderYmd(order) {
  const raw = order?.order_date;
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [yy, mm, dd] = s.slice(0, 10).split("-").map(Number);
    const dt = new Date(yy, mm - 1, dd);
    if (Number.isNaN(dt.getTime())) return null;
    return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
  }
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return null;
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function parseLooseNumber(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim().replace(/[\s\u00A0\u202F]/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function isOrderPaid(order) {
  const remainingToRaw = String(order?.remaining_to || "").trim();
  const paidByRemainingTo = remainingToRaw !== "" && remainingToRaw !== "—";
  const remainingAmount = parseLooseNumber(order?.remaining_amount);
  const paidByRemainingAmountZero = remainingAmount != null && Math.abs(remainingAmount) < 1e-9;
  return paidByRemainingTo || paidByRemainingAmountZero;
}

function remainingAmount(order) {
  return parseLooseNumber(order?.remaining_amount) ?? 0;
}

/** Пустой selectedKeys = все типы. Ключ __empty__ — заказы без типа. */
export function orderMatchesOrderTypeKeys(order, selectedKeys) {
  if (!selectedKeys || selectedKeys.length === 0) return true;
  const t = (order?.order_type || "").trim();
  return selectedKeys.some((key) => (key === "__empty__" ? t === "" : t === key));
}

function emptyBucket() {
  return { all: 0, over1m: 0, over3m: 0 };
}

function addToBucket(bucket, amount, ymd, cutoff1, cutoff3) {
  bucket.all += amount;
  if (!ymd) return;
  if (ymd < cutoff1) bucket.over1m += amount;
  if (ymd < cutoff3) bucket.over3m += amount;
}

/**
 * Матрица долгов: неоплаченный остаток по статусам и давности даты заказа.
 * @param {object[]} orders
 * @param {Date} [now]
 */
export function buildDebtsMatrix(orders, now = new Date()) {
  const today = todayYmd(now);
  const cutoff1 = addCalendarMonths(today, -1);
  const cutoff3 = addCalendarMonths(today, -3);
  const byStatus = Object.fromEntries(DEBT_STATUSES.map((s) => [s, emptyBucket()]));
  const total = emptyBucket();

  for (const order of orders || []) {
    if (!order) continue;
    if (isOrderPaid(order)) continue;
    const st = String(order.payment_status || "").trim();
    const bucket = byStatus[st];
    if (!bucket) continue;
    const amount = remainingAmount(order);
    if (!amount) continue;
    const ymd = orderYmd(order);
    addToBucket(bucket, amount, ymd, cutoff1, cutoff3);
    addToBucket(total, amount, ymd, cutoff1, cutoff3);
  }

  return { byStatus, total, cutoff1, cutoff3 };
}
