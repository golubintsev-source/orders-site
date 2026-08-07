/**
 * Проверка сценариев голосового ассистента: info / create / update / expense.
 * Запуск: node scripts/test-voice-scenarios.js
 */
const {
  tryDeterministicLastOrdersAnswer,
  tryDeterministicExpenseProposal,
  finalizeAssistantPayload,
  missingCreateRequired,
  missingCalculationRequired,
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
  assert(
    missingCreateRequired({ client: "А", payment_status: "Контакт с клиентом" }).includes("адрес"),
    "missing address"
  );
  assert(
    missingCreateRequired({
      client: "А",
      payment_status: "Контакт с клиентом",
      address: "Ленина 1",
    }).length === 0,
    "ok"
  );
}

{
  const r = finalizeAssistantPayload(
    {
      action: "propose_create_order",
      speak: "Создаю",
      order: { client: "Иванов", amount: 1000 },
    },
    { canCreateOrders: true, canCreateCalculations: true, orders, mentionMatches: [] }
  );
  assert(r.action === "clarify", `create without status -> clarify, got ${r.action}`);
  assert(/статус/i.test(r.speak), `ask status: ${r.speak}`);
  assert(r.order && r.order.client === "Иванов", "keep partial draft");
}

{
  const r = finalizeAssistantPayload(
    {
      action: "propose_create_order",
      speak: "Создаю",
      order: { client: "Иванов", payment_status: "Контакт с клиентом", amount: 1000 },
    },
    { canCreateOrders: true, canCreateCalculations: true, orders, mentionMatches: [] }
  );
  assert(r.action === "clarify", `create without address -> clarify, got ${r.action}`);
  assert(/адрес/i.test(r.speak), `ask address: ${r.speak}`);
}

{
  const r = finalizeAssistantPayload(
    {
      action: "propose_create_order",
      speak: "Ок",
      order: { client: "Иванов", payment_status: "Контакт с клиентом", address: "Ленина 1", amount: 50000 },
    },
    { canCreateOrders: true, canCreateCalculations: true, orders, mentionMatches: [] }
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
      canCreateCalculations: true,
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
      canCreateCalculations: true,
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
    { canCreateOrders: true, canCreateCalculations: true, orders, mentionMatches: [] }
  );
  assert(r.action === "clarify", `update without patch: ${r.action}`);
  assert(/что/i.test(r.speak), `ask what to change: ${r.speak}`);
}

{
  const r = finalizeAssistantPayload(
    {
      action: "propose_create_order",
      speak: "x",
      order: { client: "A", payment_status: "Контакт с клиентом", address: "Ленина 1" },
    },
    { canCreateOrders: false, canCreateCalculations: true, orders, mentionMatches: [] }
  );
  assert(r.action === "answer", "no rights create");
}

{
  // Модель часто возвращает полный объект с null по неизменённым полям —
  // пустые client/status/address не должны попасть в патч правки.
  const r = finalizeAssistantPayload(
    {
      action: "propose_update_order",
      speak: "Добавляю описание. Подтвердите изменение?",
      order_id: 1015,
      order: {
        client: null,
        payment_status: null,
        description: "Обязательно провести повторный замер",
        address: null,
      },
    },
    { canCreateOrders: true, canCreateCalculations: true, orders, mentionMatches: [] }
  );
  assert(r.action === "propose_update_order", `null client/status/address stripped: ${r.action}`);
  assert(r.order && r.order.description === "Обязательно провести повторный замер", "description kept");
  assert(!("client" in r.order), "empty client removed from patch");
  assert(!("payment_status" in r.order), "empty status removed from patch");
  assert(!("address" in r.order), "empty address removed from patch");
}

{
  const { normalizeUpdatePatch } = require("../api/voice-assistant.js");
  const p = normalizeUpdatePatch({
    client: "",
    payment_status: null,
    address: null,
    description: "x",
  });
  assert(p.description === "x", "normalize keeps description");
  assert(
    !("client" in p) && !("payment_status" in p) && !("address" in p),
    "normalize drops empty required"
  );
}

{
  // Карточка подтверждения правки: Клиент/Статус/Адрес показываем из текущего заказа,
  // если в патче их нет (иначе UI рисует «—»).
  function mergeUpdateConfirmDisplay(existing, patch) {
    const display = { ...(patch && typeof patch === "object" ? patch : {}) };
    if (display.client == null || display.client === "") {
      display.client = existing?.client ?? null;
    }
    if (display.payment_status == null || display.payment_status === "") {
      display.payment_status = existing?.payment_status ?? null;
    }
    if (display.address == null || display.address === "") {
      display.address = existing?.address ?? null;
    }
    return display;
  }
  const d = mergeUpdateConfirmDisplay(orders[0], {
    description: "Обязательно провести повторный замер",
  });
  assert(d.client === "Иванов", `confirm card client: ${d.client}`);
  assert(d.payment_status === "Производство", `confirm card status: ${d.payment_status}`);
  assert(d.address === "Ленина 10", `confirm card address: ${d.address}`);
  assert(d.description === "Обязательно провести повторный замер", "confirm card description");

  const d2 = mergeUpdateConfirmDisplay(orders[0], {
    client: "Новый клиент",
    description: "текст",
  });
  assert(d2.client === "Новый клиент", "patch client overrides existing");
  assert(d2.payment_status === "Производство", "status still from existing");
  assert(d2.address === "Ленина 10", "address still from existing");
}

{
  assert(missingCalculationRequired({}).includes("сумму"), "calc missing amount");
  assert(missingCalculationRequired({ amount: 100 }).some((x) => /на что/i.test(x)), "calc missing desc");
  assert(missingCalculationRequired({ amount: 100, description: "бензин" }).length === 0, "calc ok");
}

{
  const r = tryDeterministicExpenseProposal("Внеси расход 5000 на бензин");
  assert(r && r.action === "propose_create_calculation", `expense action: ${r && r.action}`);
  assert(r.calculation && r.calculation.amount === 5000, `expense amount: ${r && r.calculation && r.calculation.amount}`);
  assert(/бензин/i.test(r.calculation.description), `expense desc: ${r.calculation.description}`);
  assert(r.calculation.to_place === "Покупка", "default to_place Покупка");
  assert(/\?/.test(r.speak), `expense ask confirm: ${r.speak}`);
}

{
  const r = tryDeterministicExpenseProposal("Потратил 1500 за материалы");
  assert(r && r.action === "propose_create_calculation", `spent action: ${r && r.action}`);
  assert(r.calculation.amount === 1500, "spent amount");
  assert(/материал/i.test(r.calculation.description), `spent desc: ${r.calculation.description}`);
}

{
  const r = tryDeterministicExpenseProposal("Внеси расход 2000");
  assert(r && r.action === "clarify", `expense without desc -> clarify: ${r && r.action}`);
  assert(r.calculation && r.calculation.amount === 2000, "partial amount kept");
}

{
  const r = tryDeterministicExpenseProposal("Создай заказ для Иванова");
  assert(r == null, "order create must not be expense");
}

{
  const r = finalizeAssistantPayload(
    {
      action: "propose_create_calculation",
      speak: "Записать?",
      calculation: { amount: 3000, description: "краска" },
    },
    { canCreateOrders: true, canCreateCalculations: true, orders, mentionMatches: [] }
  );
  assert(r.action === "propose_create_calculation", `finalize expense: ${r.action}`);
  assert(r.calculation.amount === 3000 && r.calculation.description === "краска", "calc draft");
  assert(r.calculation.to_place === "Покупка", "default to_place in finalize");
  assert(r.order == null, "no order on expense");
}

{
  const r = finalizeAssistantPayload(
    {
      action: "propose_create_calculation",
      speak: "x",
      calculation: { amount: 100, description: "тест" },
    },
    { canCreateOrders: true, canCreateCalculations: false, orders, mentionMatches: [] }
  );
  assert(r.action === "answer", "no rights calculation");
}

{
  const r = finalizeAssistantPayload(
    {
      action: "propose_create_calculation",
      speak: "Ок",
      calculation: { description: "бензин" },
    },
    { canCreateOrders: true, canCreateCalculations: true, orders, mentionMatches: [] }
  );
  assert(r.action === "clarify", `expense without amount: ${r.action}`);
  assert(/сумм/i.test(r.speak), `ask amount: ${r.speak}`);
}

console.log("ok: voice scenarios (info / create / update / expense)");
