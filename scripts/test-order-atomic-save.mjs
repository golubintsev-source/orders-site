import assert from "node:assert/strict";
import {
  ATOMIC_ORDER_ID_PLACEHOLDER,
  buildAtomicOrderRequestSignature,
  createAtomicOrderRequestId,
  saveOrderAtomic,
} from "../js/order-atomic-save.js";

assert.equal(ATOMIC_ORDER_ID_PLACEHOLDER, "{{ORDER_ID}}");
assert.match(createAtomicOrderRequestId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
assert.equal(
  buildAtomicOrderRequestSignature({
    orderData: { amount: 10 },
    calculations: [{ created_at: "2026-09-25T10:00:00Z", amount: 10 }],
  }),
  buildAtomicOrderRequestSignature({
    orderData: { amount: 10 },
    calculations: [{ created_at: "2026-09-25T10:01:00Z", amount: 10 }],
  }),
  "Повтор с новым техническим временем должен сохранить request_id",
);

const calls = [];
const client = {
  async rpc(name, payload) {
    calls.push({ name, payload });
    return { data: 1401, error: null };
  },
};
const requestId = "11111111-1111-4111-8111-111111111111";
const orderData = { amount: 100000, remaining_to: "Безнал" };
const historyComments = ["Кому остаток: — -> Безнал"];
const calculations = [{ amount: 100000, comment: "[AUTO_ORDER_DELTA] Остаток; {{ORDER_ID}}" }];
const expectedMoney = { amount: 100000, remaining_to: null };

assert.equal(
  await saveOrderAtomic(client, {
    requestId,
    orderId: 1401,
    orderData,
    historyComments,
    calculations,
    expectedMoney,
  }),
  1401,
);
assert.deepEqual(calls, [{
  name: "save_order_atomic",
  payload: {
    p_request_id: requestId,
    p_order_id: 1401,
    p_order: orderData,
    p_history_comments: historyComments,
    p_calculations: calculations,
    p_expected_money: expectedMoney,
  },
}]);

const dbError = Object.assign(new Error("calculation insert failed"), { code: "23514" });
await assert.rejects(
  saveOrderAtomic(
    { rpc: async () => ({ data: null, error: dbError }) },
    { requestId, orderData },
  ),
  (error) => error === dbError,
);

let rpcCalls = 0;
await assert.rejects(
  saveOrderAtomic(
    { rpc: async () => { rpcCalls += 1; return { data: null, error: null }; } },
    { requestId, orderData },
  ),
  /не вернула номер/,
);
assert.equal(rpcCalls, 1, "При некорректном ответе не должно быть раздельного fallback-сохранения");

console.log("order atomic save tests: ok");
