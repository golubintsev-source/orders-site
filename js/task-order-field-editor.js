import { orderFieldLabel, validOrderField } from "./order-cell-highlights.js";

const DATE_FIELDS = new Set(["order_date", "delivery_date", "installation_date", "reveals_date"]);
const NUMBER_FIELDS = new Set([
  "amount", "prepayment", "remaining_amount", "area_m2", "installer_payment_amount",
  "mosquito_nets", "construction_count",
]);
const READ_ONLY_FIELDS = new Set(["id", "paid"]);

function inputValue(field, raw) {
  if (raw == null) return "";
  if (field === "payment_status" && String(raw).trim() === "нет") return "Контакт с клиентом";
  if (DATE_FIELDS.has(field)) return String(raw).slice(0, 10);
  return String(raw);
}

function normalizeInputValue(field, raw) {
  const value = String(raw ?? "").trim();
  if (field === "payment_status" && value === "Контакт с клиентом") return "нет";
  if (!NUMBER_FIELDS.has(field)) return value;
  if (!value) return null;
  const number = Number(value.replace(/\s+/g, "").replace(",", "."));
  if (!Number.isFinite(number)) throw new Error("Введите корректное числовое значение.");
  return number;
}

export async function loadTaskOrderField(orderId, sourceOrderField) {
  const field = validOrderField(sourceOrderField);
  const id = Number(orderId);
  if (!field || !Number.isFinite(id) || id <= 0) return null;

  const orders = await import("./orders.js");
  const order = await orders.getOrderRowForFullTooltip(id);
  if (!order) throw new Error("Не удалось загрузить поле заказа.");
  let rawValue = order[field];
  if (field === "id") rawValue = order.id;
  if (field === "paid") {
    rawValue = order.amount == null || order.amount === "" ? "" : (orders.isOrderPaid(order) ? "да" : "нет");
  }
  return {
    field,
    label: orderFieldLabel(field),
    value: inputValue(field, rawValue),
    inputType: DATE_FIELDS.has(field) ? "date" : NUMBER_FIELDS.has(field) ? "number" : "text",
    editable: !READ_ONLY_FIELDS.has(field),
  };
}

export async function saveTaskOrderField(orderId, sourceOrderField, rawValue, initialValue) {
  const field = validOrderField(sourceOrderField);
  if (!field || READ_ONLY_FIELDS.has(field) || String(rawValue ?? "") === String(initialValue ?? "")) return false;
  const orders = await import("./orders.js");
  const result = await orders.updateOrderFromVoicePayload(orderId, {
    [field]: normalizeInputValue(field, rawValue),
  });
  if (!result?.ok) throw new Error(result?.message || "Не удалось изменить поле заказа.");
  await orders.loadOrders();
  return true;
}

export function buildOrderNumberText(orderId) {
  const number = Number(orderId);
  return Number.isFinite(number) && number > 0 ? String(number).padStart(4, "0") : String(orderId || "");
}
