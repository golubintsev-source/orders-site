const HISTORY_LABEL_TO_KEY = {
  "Тип заказа": "order_type",
  "Номер заказа": "order_number",
  "Дата и время заказа": "order_date",
  Телефон: "phone",
  Клиент: "client",
  Адрес: "address",
  Статус: "payment_status",
  Комментарий: "description",
  Стоимость: "amount",
  Предоплата: "prepayment",
  "Кому предоплата": "prepayment_to",
  Остаток: "remaining_amount",
  "Кому остаток": "remaining_to",
  "Площадь м²": "area_m2",
  "Москитные сетки": "mosquito_nets",
  Конструкций: "construction_count",
  Доставка: "delivery",
  "Дата доставки": "delivery_date",
  Монтаж: "installation",
  "Дата монтажа": "installation_date",
  Монтажник: "installer_name",
  Откосы: "reveals",
  "Дата откосов": "reveals_date",
  "з/п монтаж": "installer_payment_amount",
  "Кто оплатил монтаж": "installer_payment_by",
};

/** Разворачивает старые записи истории, в которых несколько изменений объединены в строку. */
export function expandOrderHistoryCommentLines(comment) {
  const c = String(comment ?? "").trim();
  if (!c) return [""];
  if (!c.includes(";")) return [c];
  const parts = c
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) return [c];

  const isHistoryEvent = (p) =>
    p === "Заказ создан" ||
    p === "Сохранено без изменений" ||
    p === "Заявка удалена" ||
    p === "Излишек создан" ||
    p === "Излишек удалён";
  const isFieldDiffPart = (p) => {
    if (isHistoryEvent(p)) return true;
    const idx = p.indexOf(":");
    if (idx <= 0) return false;
    const label = p.slice(0, idx).trim();
    return Boolean(HISTORY_LABEL_TO_KEY[label]) || /^.+: .+/.test(p);
  };

  if (parts.every(isFieldDiffPart)) return parts;
  return [c];
}
