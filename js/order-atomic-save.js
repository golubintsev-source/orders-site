export const ATOMIC_ORDER_ID_PLACEHOLDER = "{{ORDER_ID}}";

export function createAtomicOrderRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, "0").slice(-12)}`;
}

/** created_at формируется заново при каждом клике и не должно менять id повтора. */
export function buildAtomicOrderRequestSignature(payload) {
  const calculations = (payload?.calculations || []).map(({ created_at: _createdAt, ...row }) => row);
  return JSON.stringify({ ...payload, calculations });
}

/**
 * Сохраняет заказ, его историю и автопроводки одним вызовом PostgreSQL-функции.
 * Намеренно нет fallback на раздельные INSERT/UPDATE: это нарушило бы атомарность.
 */
export async function saveOrderAtomic(
  client,
  {
    requestId,
    orderId = null,
    orderData,
    historyComments = [],
    calculations = [],
    expectedMoney = null,
  },
) {
  if (!client?.rpc) throw new Error("Клиент базы данных не поддерживает RPC");
  if (!requestId) throw new Error("Не задан идентификатор транзакции сохранения");
  if (!orderData || typeof orderData !== "object" || Array.isArray(orderData)) {
    throw new Error("Не заданы данные заказа");
  }

  const { data, error } = await client.rpc("save_order_atomic", {
    p_request_id: requestId,
    p_order_id: orderId,
    p_order: orderData,
    p_history_comments: historyComments,
    p_calculations: calculations,
    p_expected_money: expectedMoney,
  });
  if (error) throw error;

  const savedOrderId = Number(Array.isArray(data) ? data[0]?.id ?? data[0] : data?.id ?? data);
  if (!Number.isFinite(savedOrderId) || savedOrderId <= 0) {
    throw new Error("Транзакция не вернула номер сохранённого заказа");
  }
  return savedOrderId;
}
