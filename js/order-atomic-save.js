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

export const ORDER_SAVE_ATTEMPT_TIMEOUT_MS = 12000;

function isRetryableAtomicSaveError(error) {
  const code = String(error?.code || "").toUpperCase();
  const name = String(error?.name || "");
  const message = String(error?.message || error || "");
  return code === "ORDER_SAVE_TIMEOUT" ||
    name === "AbortError" ||
    /failed to fetch|networkerror|load failed|network request failed|thread killed by timeout/i.test(message);
}

function runWithHardTimeout(promise, controller, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      controller?.abort();
      reject(Object.assign(
        new Error("Сервер не ответил вовремя"),
        { code: "ORDER_SAVE_TIMEOUT" },
      ));
    }, timeoutMs);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
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
    signal = null,
  },
) {
  if (!client?.rpc) throw new Error("Клиент базы данных не поддерживает RPC");
  if (!requestId) throw new Error("Не задан идентификатор транзакции сохранения");
  if (!orderData || typeof orderData !== "object" || Array.isArray(orderData)) {
    throw new Error("Не заданы данные заказа");
  }

  const request = client.rpc("save_order_atomic", {
    p_request_id: requestId,
    p_order_id: orderId,
    p_order: orderData,
    p_history_comments: historyComments,
    p_calculations: calculations,
    p_expected_money: expectedMoney,
  });
  const response = signal && typeof request?.abortSignal === "function"
    ? request.abortSignal(signal)
    : request;
  const { data, error } = await response;
  if (error) throw error;

  const savedOrderId = Number(Array.isArray(data) ? data[0]?.id ?? data[0] : data?.id ?? data);
  if (!Number.isFinite(savedOrderId) || savedOrderId <= 0) {
    throw new Error("Транзакция не вернула номер сохранённого заказа");
  }
  return savedOrderId;
}

/**
 * POST не повторяется supabase-js автоматически. Повтор безопасен, потому что
 * один request_id идемпотентно возвращает номер уже сохранённого заказа.
 */
export async function saveOrderAtomicWithRetry(
  client,
  payload,
  {
    attemptTimeoutMs = ORDER_SAVE_ATTEMPT_TIMEOUT_MS,
    maxAttempts = 2,
    onRetry = null,
  } = {},
) {
  let lastError = null;
  const attempts = Math.max(1, Number(maxAttempts) || 1);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    try {
      return await runWithHardTimeout(
        saveOrderAtomic(client, { ...payload, signal: controller?.signal || null }),
        controller,
        Math.max(1, Number(attemptTimeoutMs) || ORDER_SAVE_ATTEMPT_TIMEOUT_MS),
      );
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryableAtomicSaveError(error)) throw error;
      if (typeof onRetry === "function") onRetry(attempt + 1, error);
    }
  }
  throw lastError;
}
