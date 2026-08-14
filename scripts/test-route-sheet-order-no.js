/**
 * Локальная проверка разбора номера заказа для «Точка по номеру».
 * Запуск: node scripts/test-route-sheet-order-no.js
 *
 * Зеркалит логику findOrderByRouteSheetNumberInput (без DOM/state).
 */
function formatOrderIdTypeChip(orderId, orderType) {
  if (orderId == null || orderId === "") return "";
  const letter = (orderType || "").trim().charAt(0);
  const base = String(orderId).padStart(4, "0");
  return letter ? `${base}_${letter}` : base;
}

function findOrderByRouteSheetNumberInput(raw, orders) {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    if (!Number.isFinite(n)) return null;
    return orders.find((o) => Number(o.id) === n) ?? null;
  }

  const norm = s.replace(/\s+/g, "");
  const normLower = norm.toLowerCase();
  for (const o of orders) {
    const chip = formatOrderIdTypeChip(o.id, o.order_type);
    if (!chip) continue;
    if (chip.replace(/\s+/g, "").toLowerCase() === normLower) return o;
  }

  const m = norm.match(/^0*(\d+)[_.,\-]*(.*)$/u);
  if (m) {
    const n = parseInt(m[1], 10);
    const suffix = (m[2] || "").trim();
    if (Number.isFinite(n)) {
      const found = orders.find((o) => {
        if (Number(o.id) !== n) return false;
        if (!suffix) return true;
        const type = (o.order_type || "").trim();
        const letter = type.charAt(0);
        if (!letter) return false;
        const sufLower = suffix.toLowerCase();
        return letter.toLowerCase() === sufLower.charAt(0) || type.toLowerCase() === sufLower;
      });
      if (found) return found;
    }
  }

  return null;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const orders = [
  { id: 112, order_type: "Окна" },
  { id: 1113, order_type: "Окна" },
  { id: 970, order_type: "Подоконники" },
];

assert(formatOrderIdTypeChip(112, "Окна") === "0112_О", "pad for id<1000");
assert(formatOrderIdTypeChip(1113, "Окна") === "1113_О", "no pad for id>=1000");

assert(findOrderByRouteSheetNumberInput("1113", orders)?.id === 1113, "digits 1113");
assert(findOrderByRouteSheetNumberInput("01113", orders)?.id === 1113, "digits with leading 0");
assert(findOrderByRouteSheetNumberInput("1113_О", orders)?.id === 1113, "exact chip >=1000");
assert(findOrderByRouteSheetNumberInput("01113_О", orders)?.id === 1113, "padded chip for >=1000");
assert(findOrderByRouteSheetNumberInput("0112_О", orders)?.id === 112, "exact chip <1000");
assert(findOrderByRouteSheetNumberInput("112", orders)?.id === 112, "digits 112");
assert(findOrderByRouteSheetNumberInput("112_О", orders)?.id === 112, "unpadded chip <1000");
assert(findOrderByRouteSheetNumberInput("9999", orders) == null, "missing id");

function routeSheetDefaultDateDeltaDays(weekday) {
  return weekday === 5 ? 3 : 1;
}

function getTomorrowIsoDate(now) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() + routeSheetDefaultDateDeltaDays(d.getDay()));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getRouteSheetActiveDeliveryDate(fromValue, now) {
  const raw = String(fromValue ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return getTomorrowIsoDate(now);
}

// Пятница 14 авг 2026 → понедельник 17 авг, не суббота 15 авг
const friday = new Date(2026, 7, 14, 16, 0, 0);
assert(friday.getDay() === 5, "fixture is Friday");
assert(getTomorrowIsoDate(friday) === "2026-08-17", "Friday default is Monday");
assert(getRouteSheetActiveDeliveryDate("2026-08-17", friday) === "2026-08-17", "add order uses sheet date");
assert(getRouteSheetActiveDeliveryDate("", friday) === "2026-08-17", "empty sheet date falls back to Monday");

const thursday = new Date(2026, 7, 13, 10, 0, 0);
assert(thursday.getDay() === 4, "fixture is Thursday");
assert(getTomorrowIsoDate(thursday) === "2026-08-14", "Thursday default is Friday");

console.log("ok: route-sheet order number lookup");
