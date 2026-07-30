/**
 * Проверка детерминированных ответов про последний заказ (номер vs сумма).
 * Запуск: node scripts/test-voice-last-orders-answer.js
 */
const { tryDeterministicLastOrdersAnswer } = require("../api/voice-assistant.js");

const orders = [
  { id: 1015, amount: 50000, client: "Иванов", address: "Ленина 10" },
  { id: 1014, amount: 12000, client: "Петров", address: "Мира 3" },
  { id: 1013, amount: null, client: "Сидоров", address: "Садовая 1" },
];

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

{
  const r = tryDeterministicLastOrdersAnswer("какой номер последнего заказа", orders);
  assert(r && r.speak.includes("1015"), `id ask -> 1015, got ${r && r.speak}`);
  assert(!/рубл/.test(r.speak), `id ask should not mention rubles: ${r.speak}`);
}

{
  const r = tryDeterministicLastOrdersAnswer("Какая стоимость по последнему заказу", orders);
  assert(r, "cost ask should be answered deterministically");
  assert(/50000|50 000/.test(r.speak), `cost ask should include amount, got: ${r.speak}`);
  assert(/рубл/.test(r.speak), `cost ask should say rubles: ${r.speak}`);
  assert(/1015/.test(r.speak), `cost ask may include id for context: ${r.speak}`);
  assert(!/^Последний заказ — номер/.test(r.speak), `must not answer only with order number: ${r.speak}`);
}

{
  const r = tryDeterministicLastOrdersAnswer("Какая сумма по последнему заказу?", orders);
  assert(r && /50 000/.test(r.speak), `сумма ask -> 50 000, got ${r && r.speak}`);
}

{
  const r = tryDeterministicLastOrdersAnswer("сколько стоит последний заказ", orders);
  assert(r && /50 000/.test(r.speak), `сколько стоит -> amount, got ${r && r.speak}`);
}

{
  const r = tryDeterministicLastOrdersAnswer("суммы последних двух заказов", orders);
  assert(r && /1015/.test(r.speak) && /1014/.test(r.speak), `two amounts, got ${r && r.speak}`);
  assert(/50 000/.test(r.speak) && /12 000/.test(r.speak), `amounts in list: ${r.speak}`);
}

{
  const noAmount = [{ id: 1015, amount: null }];
  const r = tryDeterministicLastOrdersAnswer("какая стоимость по последнему заказу", noAmount);
  assert(r && /не указана/.test(r.speak), `missing amount: ${r && r.speak}`);
}

{
  const r = tryDeterministicLastOrdersAnswer("какой адрес последнего заказа", orders);
  assert(r && /Ленина|адрес/i.test(r.speak), `address ask should return address, got ${r && r.speak}`);
}

{
  const r = tryDeterministicLastOrdersAnswer("последние три заказа", orders);
  assert(r && r.speak.includes("1015") && r.speak.includes("1014") && r.speak.includes("1013"), `list ids: ${r && r.speak}`);
}

console.log("ok: voice last orders deterministic answers");
