/**
 * Проверка сценариев голосового ассистента: info / create / update.
 * Запуск: node scripts/test-voice-scenarios.js
 */
const {
  tryDeterministicLastOrdersAnswer,
  finalizeAssistantPayload,
  missingCreateRequired,
} = require("../api/voice-assistant.js");

const orders = [
  {
    id: 1015,
    amount: 50000,
    client: "Иванов",
    address: "Ленина 10",
    description: "Окна на кухню",
    payment_status: "Производство",
    phone: "79001234567",
  },
  {
    id: 1014,
    amount: 12000,
    client: "Петров",
    address: "Мира 3",
    description: "Подоконник",
    payment_status: "Контакт с клиентом",
    phone: null,
  },
];

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

{
  const r = tryDeterministicLastOrdersAnswer("Какая стоимость по последнему заказу", orders);
  assert(r && /50 000/.test(r.speak), `cost -> amount: ${r && r.speak}`);
}

{
  const r = tryDeterministicLastOrdersAnswer("какой адрес последнего заказа", orders);
  assert(r && /Ленина/.test(r.speak), `address: ${r && r.speak}`);
}

{
  const r = tryDeterministicLastOrdersAnswer("измени адрес последнего заказа", orders);
  assert(r == null, "edit intent must not be answered as info");
}

{
  assert(missingCreateRequired({}).includes("клиент"), "missing client");
  assert(missingCreateRequired({ client: "А" }).includes("статус"), "missing status");
  assert(missingCreateRequired({ client: "А", payment_status: "Контакт с клиентом" }).length === 0, "ok");
}

{
  const r = finalizeAssistantPayload(
    {
      action: "propose_create_order",
      speak: "Создаю",
      order: { client: "Иванов", amount: 1000 },
    },
    { canCreateOrders: true, orders, mentionMatches: [] }
  );
  assert(r.action === "clarify", `create without status -> clarify, got ${r.action}`);
  assert(/статус/i.test(r.speak), `ask status: ${r.speak}`);
  assert(r.order && r.order.client === "Иванов", "keep partial draft");
}

{
  const r = finalizeAssistantPayload(
    {
      action: "propose_create_order",
      speak: "Ок",
      order: { client: "Иванов", payment_status: "Контакт с клиентом", address: "Ленина 1", amount: 50000 },
    },
    { canCreateOrders: true, orders, mentionMatches: [] }
  );
  assert(r.action === "propose_create_order", `full create: ${r.action}`);
  assert(/Иванов/.test(r.speak) && /статус/i.test(r.speak), `list params: ${r.speak}`);
  assert(/\?/.test(r.speak), `ask confirm: ${r.speak}`);
}

{
  const r = finalizeAssistantPayload(
    {
      action: "propose_update_order",
      speak: "Меняю",
      order_id: null,
      order: { address: "Новый адрес" },
    },
    {
      canCreateOrders: true,
      orders,
      mentionMatches: [
        { order: orders[0], score: 10 },
        { order: orders[1], score: 9 },
      ],
    }
  );
  assert(r.action === "clarify", `multi match -> clarify: ${r.action}`);
  assert(/1015/.test(r.speak) && /1014/.test(r.speak), `list ids: ${r.speak}`);
}

{
  const r = finalizeAssistantPayload(
    {
      action: "propose_update_order",
      speak: "Меняю адрес",
      order_id: null,
      order: { address: "Новый адрес" },
    },
    {
      canCreateOrders: true,
      orders,
      mentionMatches: [{ order: orders[0], score: 10 }],
    }
  );
  assert(r.action === "propose_update_order", `single match update: ${r.action}`);
  assert(Number(r.order_id) === 1015, `order_id 1015, got ${r.order_id}`);
  assert(r.order && r.order.address === "Новый адрес", "patch kept");
}

{
  const r = finalizeAssistantPayload(
    {
      action: "propose_update_order",
      speak: "Найден",
      order_id: 1015,
      order: {},
    },
    { canCreateOrders: true, orders, mentionMatches: [] }
  );
  assert(r.action === "clarify", `update without patch: ${r.action}`);
  assert(/что/i.test(r.speak), `ask what to change: ${r.speak}`);
}

{
  const r = finalizeAssistantPayload(
    { action: "propose_create_order", speak: "x", order: { client: "A", payment_status: "Контакт с клиентом" } },
    { canCreateOrders: false, orders, mentionMatches: [] }
  );
  assert(r.action === "answer", "no rights create");
}

console.log("ok: voice scenarios (info / create / update)");
