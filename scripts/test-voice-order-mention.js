/**
 * Локальная проверка поиска заказа по упоминанию в голосе.
 * Запуск: node scripts/test-voice-order-mention.js
 */
const {
  findOrdersByMention,
  messageLooksLikeOrderMention,
} = require("../api/voice-assistant.js");

const orders = [
  {
    id: 973,
    order_number: null,
    client: "Иванов Иван",
    address: "ул. Ленина, 15",
    description: "Окна на кухню белые",
    order_type: "Окна",
  },
  {
    id: 970,
    order_number: "A-12",
    client: "Петрова Мария",
    address: "пр. Мира, 3",
    description: "Подоконник в спальню",
    order_type: "Подоконники",
  },
  {
    id: 955,
    order_number: null,
    client: "Сидоров",
    address: "Ленинский проспект 40",
    description: "Сетка на балкон",
    order_type: "Сетки/мелочь",
  },
];

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function idsOf(matches) {
  return matches.map((m) => m.order.id);
}

{
  const m = findOrdersByMention("какой статус у заказа 973", orders);
  assert(idsOf(m)[0] === 973, `id 973 expected, got ${idsOf(m)}`);
}

{
  const m = findOrdersByMention("заказ Иванова", orders);
  assert(idsOf(m).includes(973), `client Иванова -> 973, got ${idsOf(m)}`);
}

{
  const m = findOrdersByMention("что по заказу Петровой", orders);
  assert(idsOf(m).includes(970), `partial client Петровой -> 970, got ${idsOf(m)}`);
}

{
  const m = findOrdersByMention("заказ на Ленина", orders);
  assert(idsOf(m).some((id) => id === 973 || id === 955), `address Ленина, got ${idsOf(m)}`);
}

{
  const m = findOrdersByMention("заказ про окна на кухню", orders);
  assert(idsOf(m)[0] === 973, `description кухню -> 973, got ${idsOf(m)}`);
}

{
  const m = findOrdersByMention("заказ A-12", orders);
  assert(idsOf(m).includes(970), `order_number A-12 -> 970, got ${idsOf(m)}`);
}

{
  assert(messageLooksLikeOrderMention("статус заказа Иванова") === true, "mention detect");
  assert(messageLooksLikeOrderMention("привет") === false, "no mention");
}

{
  const m = findOrdersByMention("заказ НесуществующийКлиентXYZ", orders);
  assert(m.length === 0, `no false match, got ${idsOf(m)}`);
}

console.log("ok: voice order mention search");
