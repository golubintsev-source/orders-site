// Stable field keys: table reordering must not change a task's saved cell reference.
export const ORDER_TABLE_FIELD_KEYS = [
  "id", "order_date", "client", "paid", "address", "description", "payment_status",
  "amount", "prepayment", "prepayment_to", "remaining_amount", "remaining_to", "delivery",
  "delivery_date", "installation_date", "area_m2", "installer_payment_amount",
  "installer_payment_by", "reveals_date", "mosquito_nets", "construction_count", "phone",
];

const ORDER_TABLE_FIELD_LABELS = {
  id: "Номер", order_date: "Дата", client: "Клиент", paid: "Опл.", address: "Адрес",
  description: "Описание", payment_status: "Статус", amount: "Стоимость", prepayment: "Предоплата",
  prepayment_to: "Кому", remaining_amount: "Остаток", remaining_to: "Кому", delivery: "Отправка",
  delivery_date: "Дата", installation_date: "Монтаж", area_m2: "м2", installer_payment_amount: "з/п",
  installer_payment_by: "Оплатил", reveals_date: "Откосы", mosquito_nets: "Моск.", construction_count: "Конс.", phone: "Телефон",
};

export function orderFieldLabel(value) {
  return validOrderField(value) ? ORDER_TABLE_FIELD_LABELS[value] : "";
}

export function validOrderField(value) {
  return ORDER_TABLE_FIELD_KEYS.includes(value) ? value : null;
}

export function buildOrderCellHighlights(tasks) {
  const highlights = new Map();
  for (const task of tasks || []) {
    const id = Number(task.order_id);
    const field = validOrderField(task.source_order_field);
    if (task.deleted_at || task.highlight_order_field !== true || !field || !Number.isFinite(id) || id <= 0) continue;
    const key = `${id}:${field}`;
    const completed = [true, 1, "1"].includes(task.is_completed);
    // A pending task takes priority when several tasks reference the same cell.
    if (!completed || !highlights.has(key)) highlights.set(key, completed ? "completed" : "pending");
  }
  return highlights;
}
