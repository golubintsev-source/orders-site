import { supabaseClient, isOfflineWorkModeEnabled } from "./config.js";
import { state } from "./state.js";

const SNAP_KEY = "orders_site_offline_snap_v1";
const PENDING_ORDERS_KEY = "orders_site_offline_pending_v1";
const PENDING_TASKS_KEY = "orders_site_offline_pending_tasks_v1";
const PENDING_HISTORY_KEY = "orders_site_offline_pending_history_v1";
const PENDING_CALCS_KEY = "orders_site_offline_pending_calcs_v1";
/** Правки существующих заказов с сервера (положительный id), ещё не отправленные в БД. */
const PENDING_ORDER_EDITS_KEY = "orders_site_offline_pending_edits_v1";
/** Последний отображаемый список заказов (для F5 без сети, даже если основной snap пуст). */
const EMERGENCY_ORDERS_KEY = "orders_site_emergency_orders_v1";
/** Готовые числа страницы «Баланс» (без пересчёта из расчётов офлайн). */
const BALANCE_OFFLINE_VIEW_KEY = "orders_site_balance_offline_view_v1";

const SNAP_VERSION = 1;
const BALANCE_OFFLINE_VIEW_VERSION = 1;
const PENDING_VERSION = 1;

function readJson(key, fallback) {
  if (!isOfflineWorkModeEnabled()) return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(key, val) {
  if (!isOfflineWorkModeEnabled()) return;
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (e) {
    console.warn("offline-cache write failed:", e);
  }
}

export function cloneOrderWithoutOfflineMeta(row) {
  if (!row || typeof row !== "object") return row;
  const o = { ...row };
  delete o.__offlineLocalId;
  delete o.__offlineEditLocalId;
  delete o.__offlinePendingSync;
  return o;
}

/** Подписи полей в order_history.comment (синхронно с ORDER_HISTORY_FIELDS в orders.js). */
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

function normHistoryNumber(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function numbersEqualHistory(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) < 1e-9;
}

function valuesEqualForOrderHistory(key, a, b) {
  if (key === "installation" || key === "reveals") return !!a === !!b;
  if (
    key === "amount" ||
    key === "prepayment" ||
    key === "remaining_amount" ||
    key === "installer_payment_amount" ||
    key === "area_m2" ||
    key === "mosquito_nets" ||
    key === "construction_count"
  ) {
    return numbersEqualHistory(normHistoryNumber(a), normHistoryNumber(b));
  }
  if (key === "order_date" || key === "delivery_date" || key === "installation_date" || key === "reveals_date") {
    const sa = a == null || a === "" ? null : String(a).trim();
    const sb = b == null || b === "" ? null : String(b).trim();
    if (sa == null && sb == null) return true;
    if (sa == null || sb == null) return false;
    return sa === sb;
  }
  const sa = a == null || a === "" ? null : String(a).trim();
  const sb = b == null || b === "" ? null : String(b).trim();
  if (sa == null && sb == null) return true;
  if (sa == null || sb == null) return false;
  return sa === sb;
}

export function getChangedOrderFieldKeys(prev, next) {
  const keys = [];
  for (const key of Object.values(HISTORY_LABEL_TO_KEY)) {
    const ov = prev ? prev[key] : undefined;
    const nv = next ? next[key] : undefined;
    if (!valuesEqualForOrderHistory(key, ov, nv)) keys.push(key);
  }
  return keys;
}

function parseFieldKeysFromHistoryComment(comment) {
  if (!comment || typeof comment !== "string") return [];
  const keys = new Set();
  for (const part of expandOrderHistoryCommentLines(comment)) {
    const p = part.trim();
    if (!p || p === "Заказ создан" || p === "Сохранено без изменений" || p === "Заявка удалена") continue;
    const idx = p.indexOf(":");
    if (idx < 0) continue;
    const label = p.slice(0, idx).trim();
    const key = HISTORY_LABEL_TO_KEY[label];
    if (key) keys.add(key);
  }
  return [...keys];
}

/**
 * Старые записи истории могли склеивать несколько изменений через «; ».
 * Для отображения разворачиваем их в отдельные строки таблицы.
 * @param {string|null|undefined} comment
 * @returns {string[]}
 */
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

/** Поле → время последнего изменения в order_history строго после afterIso. */
function buildRemoteFieldChangeTimesAfter(historyRows, afterIso) {
  const t0 = new Date(afterIso || 0).getTime();
  const fieldTimes = {};
  for (const row of historyRows || []) {
    const t = new Date(row.created_at || 0).getTime();
    if (Number.isNaN(t) || t <= t0) continue;
    for (const key of parseFieldKeysFromHistoryComment(row.comment)) {
      const prev = fieldTimes[key] ? new Date(fieldTimes[key]).getTime() : 0;
      if (t > prev) fieldTimes[key] = row.created_at;
    }
  }
  return fieldTimes;
}

function stripOfflineMeta(row) {
  return cloneOrderWithoutOfflineMeta(row);
}

let tempIdCounter = 0;
export function nextOfflineTempOrderId() {
  tempIdCounter += 1;
  return -(Date.now() * 1000 + (tempIdCounter % 1000));
}

let tempTaskCounter = 0;
export function nextOfflineTempTaskId() {
  tempTaskCounter += 1;
  return -(Date.now() * 1000 + 10000 + (tempTaskCounter % 1000));
}

let tempCalcCounter = 0;
export function nextOfflineTempCalcId() {
  tempCalcCounter += 1;
  return -(Date.now() * 1000 + 20000 + (tempCalcCounter % 1000));
}

export function isOfflineClientOrderId(orderId) {
  return typeof orderId === "number" && orderId < 0;
}

export function isOfflineDataMode() {
  if (!isOfflineWorkModeEnabled()) return false;
  if (state.ordersFromCache) return true;
  if (state.dbUnavailable) return true;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return false;
}

/** Ошибка при сохранении заказа: уйти в локальную очередь вместо показа ошибки. */
export function shouldFallbackSaveOrderToLocal(err) {
  if (!isOfflineWorkModeEnabled()) return false;
  if (err?.code === "TIMEOUT") return true;
  return isNetworkFetchError(err);
}

/**
 * Ошибка сети при fetch (Safari: «TypeError: Load failed», Chrome: «Failed to fetch»).
 * Supabase может вернуть объект error с таким message или бросить исключение.
 */
export function isNetworkFetchError(err) {
  if (err == null) return false;
  const name = String(err.name || "");
  const msg = String(err.message != null ? err.message : err);
  if (name === "TypeError" && /load failed|failed to fetch|networkerror|fetch/i.test(msg)) return true;
  if (/failed to fetch|networkerror|load failed|network request failed|internet disconnected|err_network/i.test(msg))
    return true;
  return false;
}

/** iOS Safari часто долго не отклоняет fetch при «офлайне» или ложном navigator.onLine. */
export const OFFLINE_SUPABASE_WAIT_MS = 5000;

export function isBrowserOffline() {
  if (!isOfflineWorkModeEnabled()) return false;
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function raceWithTimeout(promise, ms = OFFLINE_SUPABASE_WAIT_MS) {
  if (!isOfflineWorkModeEnabled()) {
    return Promise.resolve(promise);
  }
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => {
      reject(Object.assign(new Error("timeout"), { code: "TIMEOUT" }));
    }, ms);
    Promise.resolve(promise).then(
      (val) => {
        clearTimeout(id);
        resolve(val);
      },
      (err) => {
        clearTimeout(id);
        reject(err);
      },
    );
  });
}

/**
 * Создать заказ с идемпотентностью (только INSERT, без ON CONFLICT / upsert).
 *
 * Требование: не удалять строки из БД. В базе триггер отклоняет повтор ключа
 * (unique_violation 23505) — тогда возвращаем id уже существующего заказа.
 */
export async function insertOrUpsertNewOrder(orderData, saveIdempotencyKey) {
  const q = supabaseClient.from("orders");
  if (!saveIdempotencyKey) {
    return q.insert([orderData]).select().single();
  }

  // Строго INSERT: upsert генерирует ON CONFLICT и падает без unique-constraint.
  const insertResult = await q.insert([orderData]).select().single();
  if (!insertResult.error) return insertResult;

  const code = insertResult?.error?.code;
  const msg = String(insertResult?.error?.message || "");
  if (code === "23505" || /duplicate save_idempotency_key/i.test(msg)) {
    const existing = await q
      .select("id")
      .eq("save_idempotency_key", saveIdempotencyKey)
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!existing.error && existing.data?.id != null) {
      return { data: { id: existing.data.id }, error: null };
    }
  }

  return insertResult;
}

export function readSnapshot() {
  const o = readJson(SNAP_KEY, null);
  if (!o || o.version !== SNAP_VERSION) return null;
  return o;
}

export function persistServerOrdersForOffline(orders) {
  const clean = (orders || []).map((row) => stripOfflineMeta({ ...row }));
  const prev = readSnapshot() || { version: SNAP_VERSION };
  writeJson(SNAP_KEY, {
    ...prev,
    version: SNAP_VERSION,
    at: new Date().toISOString(),
    orders: clean,
  });
}

/**
 * Сохранить последний отображаемый список заказов (копия объектов).
 * v2 — полный merged state; v1 — только «серверные» строки (устар.).
 */
export function persistEmergencyOrdersView(mergedStateAllOrders) {
  try {
    const rows = JSON.parse(JSON.stringify(mergedStateAllOrders || []));
    writeJson(EMERGENCY_ORDERS_KEY, { version: 2, at: new Date().toISOString(), rows });
  } catch (e) {
    console.warn("emergency orders persist:", e);
  }
}

/** База для merge с офлайн-очередью: без жёлтых строк (они снова подтянутся из очереди). */
export function readEmergencyOrdersBaseForMerge() {
  const o = readJson(EMERGENCY_ORDERS_KEY, null);
  if (!o) return [];
  if (o.version === 2 && Array.isArray(o.rows)) {
    return o.rows
      .filter((row) => !row.__offlinePendingSync)
      .map((row) => cloneOrderWithoutOfflineMeta({ ...row }));
  }
  if (o.version === 1 && Array.isArray(o.orders)) {
    return o.orders;
  }
  return [];
}

export function persistSettingsSnapshotFromRows(rows) {
  const prev = readSnapshot() || { version: SNAP_VERSION };
  writeJson(SNAP_KEY, {
    ...prev,
    version: SNAP_VERSION,
    at: new Date().toISOString(),
    settingsRows: rows || [],
  });
}

export function persistCalculationsSnapshot(rows) {
  const prev = readSnapshot() || { version: SNAP_VERSION };
  writeJson(SNAP_KEY, {
    ...prev,
    version: SNAP_VERSION,
    at: new Date().toISOString(),
    calculations: rows || [],
  });
}

/**
 * Сохранить отображаемые метрики баланса (после успешной загрузки из БД).
 * @param {{ balances: Record<string, number>, turnover: Record<string, { hour: number, today: number, m1: number, m2: number, m3: number }> }} payload
 */
export function persistBalanceOfflineView(payload) {
  if (!payload?.balances || !payload?.turnover) return;
  writeJson(BALANCE_OFFLINE_VIEW_KEY, {
    version: BALANCE_OFFLINE_VIEW_VERSION,
    at: new Date().toISOString(),
    balances: payload.balances,
    turnover: payload.turnover,
  });
}

/** @returns {{ version: number, at: string, balances: Record<string, number>, turnover: Record<string, object> } | null} */
export function readBalanceOfflineView() {
  const o = readJson(BALANCE_OFFLINE_VIEW_KEY, null);
  if (!o || o.version !== BALANCE_OFFLINE_VIEW_VERSION) return null;
  if (!o.balances || typeof o.balances !== "object" || !o.turnover || typeof o.turnover !== "object") return null;
  return o;
}

export function persistOrderTasksSnapshot(rows) {
  const prev = readSnapshot() || { version: SNAP_VERSION };
  writeJson(SNAP_KEY, {
    ...prev,
    version: SNAP_VERSION,
    at: new Date().toISOString(),
    order_tasks: rows || [],
  });
}

export function persistOrderHistorySnapshot(rows) {
  const prev = readSnapshot() || { version: SNAP_VERSION };
  writeJson(SNAP_KEY, {
    ...prev,
    version: SNAP_VERSION,
    at: new Date().toISOString(),
    order_history: rows || [],
  });
}

export function persistExcessHistorySnapshot(rows) {
  const prev = readSnapshot() || { version: SNAP_VERSION };
  writeJson(SNAP_KEY, {
    ...prev,
    version: SNAP_VERSION,
    at: new Date().toISOString(),
    excess_history: rows || [],
  });
}

export function persistSettingsHistorySnapshot(rows) {
  const prev = readSnapshot() || { version: SNAP_VERSION };
  writeJson(SNAP_KEY, {
    ...prev,
    version: SNAP_VERSION,
    at: new Date().toISOString(),
    settings_history: rows || [],
  });
}

export function persistCalculationHistorySnapshot(rows) {
  const prev = readSnapshot() || { version: SNAP_VERSION };
  writeJson(SNAP_KEY, {
    ...prev,
    version: SNAP_VERSION,
    at: new Date().toISOString(),
    calculation_history: rows || [],
  });
}

export function persistTaskHistorySnapshot(rows) {
  const prev = readSnapshot() || { version: SNAP_VERSION };
  writeJson(SNAP_KEY, {
    ...prev,
    version: SNAP_VERSION,
    at: new Date().toISOString(),
    task_history: rows || [],
  });
}

/* ---------- pending: orders ---------- */

function readPendingOrdersDoc() {
  const o = readJson(PENDING_ORDERS_KEY, { version: PENDING_VERSION, items: [] });
  if (!o || o.version !== PENDING_VERSION) return { items: [] };
  return { items: Array.isArray(o.items) ? o.items : [] };
}

export function readPendingQueue() {
  return readPendingOrdersDoc().items;
}

function writePendingOrderItems(items) {
  writeJson(PENDING_ORDERS_KEY, { version: PENDING_VERSION, items });
}

export function buildDisplayRowForPendingOrder(orderData, tempId, localId) {
  return {
    id: tempId,
    deleted_at: null,
    lock_edit_for_user_lite: 0,
    tasks_highlight: 0,
    ...orderData,
    __offlineLocalId: localId,
    __offlinePendingSync: true,
  };
}

export function insertPayloadFromFormData(orderData) {
  const o = { ...orderData };
  delete o.id;
  delete o.deleted_at;
  delete o.__offlineLocalId;
  delete o.__offlinePendingSync;
  delete o.lock_edit_for_user_lite;
  delete o.tasks_highlight;
  return o;
}

export function addPendingOfflineOrder({ localId, displayRow, insertPayload }) {
  const items = readPendingQueue();
  items.push({
    localId,
    displayRow,
    insertPayload,
    createdAt: new Date().toISOString(),
  });
  writePendingOrderItems(items);
}

export function updatePendingOfflineOrder(localId, displayRow, insertPayload) {
  const items = readPendingQueue();
  const i = items.findIndex((x) => x.localId === localId);
  if (i < 0) return false;
  items[i] = { ...items[i], displayRow, insertPayload };
  writePendingOrderItems(items);
  return true;
}

export function removePendingByLocalId(localId) {
  writePendingOrderItems(readPendingQueue().filter((x) => x.localId !== localId));
}

export function pendingDisplayRows() {
  return readPendingQueue().map((x) => ({ ...x.displayRow }));
}

export function sortOrdersWithOfflinePendingFirst(list) {
  return [...list].sort((a, b) => {
    const ap = a.__offlinePendingSync ? 1 : 0;
    const bp = b.__offlinePendingSync ? 1 : 0;
    if (ap !== bp) return bp - ap;
    const aid = Number(a.id);
    const bid = Number(b.id);
    if (Number.isFinite(aid) && Number.isFinite(bid)) return bid - aid;
    return 0;
  });
}

function readPendingOrderEditsDoc() {
  const o = readJson(PENDING_ORDER_EDITS_KEY, { version: PENDING_VERSION, items: [] });
  if (!o || o.version !== PENDING_VERSION) return { items: [] };
  return { items: Array.isArray(o.items) ? o.items : [] };
}

export function readPendingOrderEditsQueue() {
  return readPendingOrderEditsDoc().items;
}

function writePendingOrderEditsItems(items) {
  writeJson(PENDING_ORDER_EDITS_KEY, { version: PENDING_VERSION, items });
}

function buildDisplayRowForPendingServerEdit(orderId, orderData, editLocalId) {
  return {
    id: orderId,
    deleted_at: null,
    lock_edit_for_user_lite: 0,
    tasks_highlight: 0,
    ...orderData,
    __offlinePendingSync: true,
    __offlineEditLocalId: editLocalId,
  };
}

/**
 * Добавить или дополнить очередь офлайн-правок существующего заказа (id > 0).
 */
export function addOrAppendPendingServerOrderEdit({
  orderId,
  orderData,
  prevSnapshot,
  historyComment,
  historyComments,
  user_email,
  changedAt,
  initialSums,
  initialParticipants,
}) {
  const oid = Number(orderId);
  if (!Number.isFinite(oid) || oid <= 0) return false;
  const items = readPendingOrderEditsQueue();
  let item = items.find((x) => Number(x.orderId) === oid);
  const editLocalId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `edit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const comments = normalizePendingHistoryComments({ historyComment, historyComments });
  const editEntry = {
    editLocalId,
    changedAt: changedAt || new Date().toISOString(),
    user_email: user_email || "",
    orderData: { ...orderData },
    prevSnapshot: prevSnapshot ? { ...prevSnapshot } : null,
    historyComments: comments,
    // Старое поле — на случай очереди, собранной до обновления.
    historyComment: comments.join("; "),
    initialSums: initialSums ?? null,
    initialParticipants: initialParticipants ?? null,
  };
  if (!item) {
    const localId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `srv-edit-${Date.now()}`;
    item = {
      localId,
      orderId: oid,
      displayRow: buildDisplayRowForPendingServerEdit(oid, orderData, localId),
      edits: [editEntry],
    };
    items.push(item);
  } else {
    item.edits.push(editEntry);
    item.displayRow = buildDisplayRowForPendingServerEdit(oid, orderData, item.localId);
  }
  writePendingOrderEditsItems(items);
  return true;
}

/** Нормализует комментарии истории из очереди (массив или одна строка). */
function normalizePendingHistoryComments(edit) {
  if (Array.isArray(edit?.historyComments) && edit.historyComments.length > 0) {
    return edit.historyComments.map((c) => String(c || "").trim()).filter(Boolean);
  }
  const single = String(edit?.historyComment || "").trim();
  return single ? [single] : [];
}

export function pendingServerEditHistoryDisplayRows() {
  return readPendingOrderEditsQueue().flatMap((item) =>
    (item.edits || []).flatMap((e) => {
      const comments = normalizePendingHistoryComments(e);
      return comments.map((comment, idx) => ({
        created_at: e.changedAt,
        user_email: e.user_email,
        comment,
        order_id: item.orderId,
        __offlinePendingSync: true,
        __offlineLocalId: `${e.editLocalId}:${idx}`,
      }));
    }),
  );
}

export function mergeServerOrdersWithPendingDisplayRows(serverOrders) {
  const server = (serverOrders || []).map((row) => stripOfflineMeta({ ...row }));
  const editById = new Map(readPendingOrderEditsQueue().map((e) => [String(e.orderId), e]));
  const withEdits = server.map((row) => {
    const pending = editById.get(String(row.id));
    if (!pending?.displayRow) return row;
    return {
      ...row,
      ...stripOfflineMeta(pending.displayRow),
      id: row.id,
      __offlinePendingSync: true,
      __offlineEditLocalId: pending.localId,
    };
  });
  const pending = pendingDisplayRows();
  const serverIds = new Set(withEdits.map((s) => String(s.id)));
  const extras = pending.filter((p) => p.id != null && !serverIds.has(String(p.id)));
  return sortOrdersWithOfflinePendingFirst([...extras, ...withEdits]);
}

export function shouldSaveNewOrderToLocalQueue() {
  return isOfflineDataMode();
}

/* ---------- pending: tasks ---------- */

function readPendingTasksQueue() {
  const o = readJson(PENDING_TASKS_KEY, { version: PENDING_VERSION, items: [] });
  if (!o || o.version !== PENDING_VERSION) return [];
  return Array.isArray(o.items) ? o.items : [];
}

function writePendingTasksItems(items) {
  writeJson(PENDING_TASKS_KEY, { version: PENDING_VERSION, items });
}

export function addPendingOfflineTask({
  localId,
  tempTaskId,
  author_login,
  body,
  created_at,
  executor_emails,
  due_at,
  is_completed,
  order_id,
  source_message_id,
  source_message_kind,
}) {
  const items = readPendingTasksQueue();
  items.push({
    localId,
    tempTaskId,
    author_login,
    body,
    executor_emails: Array.isArray(executor_emails) ? executor_emails : [],
    due_at: due_at || null,
    is_completed: is_completed === true,
    order_id: order_id ?? null,
    source_message_id: source_message_id ?? null,
    source_message_kind: source_message_kind || null,
    created_at: created_at || new Date().toISOString(),
  });
  writePendingTasksItems(items);
}

export function readPendingTasksQueueForMessageLinks() {
  return readPendingTasksQueue();
}

export function updatePendingTaskCompleted(localId, isCompleted) {
  if (!localId) return;
  const items = readPendingTasksQueue();
  let changed = false;
  for (const item of items) {
    if (item.localId === localId) {
      item.is_completed = isCompleted === true;
      changed = true;
      break;
    }
  }
  if (changed) writePendingTasksItems(items);
}

export function removePendingTaskByLocalId(localId) {
  writePendingTasksItems(readPendingTasksQueue().filter((x) => x.localId !== localId));
}

export function pendingTaskDisplayRows() {
  return readPendingTasksQueue().map((t) => ({
    id: t.tempTaskId,
    author_login: t.author_login,
    body: t.body,
    executor_emails: Array.isArray(t.executor_emails) ? t.executor_emails : [],
    due_at: t.due_at || null,
    is_completed: t.is_completed === true,
    order_id: t.order_id ?? null,
    source_message_id: t.source_message_id ?? null,
    source_message_kind: t.source_message_kind || null,
    created_at: t.created_at,
    __offlinePendingSync: true,
    __offlineLocalId: t.localId,
  }));
}

export function mergeOrderTasksRowsForAllTasks(serverRows) {
  const server = (serverRows || []).map((r) => ({ ...r }));
  const pendingIds = new Set(server.map((r) => String(r.id)));
  const extras = pendingTaskDisplayRows().filter((p) => !pendingIds.has(String(p.id)));
  const merged = [...extras, ...server];
  merged.sort((a, b) => {
    const ap = a.__offlinePendingSync ? 1 : 0;
    const bp = b.__offlinePendingSync ? 1 : 0;
    if (ap !== bp) return bp - ap;
    const ta = new Date(a.created_at || 0).getTime();
    const tb = new Date(b.created_at || 0).getTime();
    return tb - ta;
  });
  return merged;
}

export function mergeOrderTasksRowsForOrder(serverRows, orderId) {
  const oid = Number(orderId);
  const extras = pendingTaskDisplayRows().filter((r) => Number(r.order_id) === oid);
  const merged = [...extras, ...(serverRows || [])];
  merged.sort((a, b) => {
    const ap = a.__offlinePendingSync ? 1 : 0;
    const bp = b.__offlinePendingSync ? 1 : 0;
    if (ap !== bp) return bp - ap;
    const ta = new Date(a.created_at || 0).getTime();
    const tb = new Date(b.created_at || 0).getTime();
    return tb - ta;
  });
  return merged;
}

/* ---------- pending: order_history ---------- */

function readPendingHistoryQueue() {
  const o = readJson(PENDING_HISTORY_KEY, { version: PENDING_VERSION, items: [] });
  if (!o || o.version !== PENDING_VERSION) return [];
  return Array.isArray(o.items) ? o.items : [];
}

function writePendingHistoryItems(items) {
  writeJson(PENDING_HISTORY_KEY, { version: PENDING_VERSION, items });
}

export function addPendingOfflineOrderHistory({
  localId,
  pending_order_local_id,
  order_temp_id,
  user_email,
  comment,
  created_at,
}) {
  const items = readPendingHistoryQueue();
  items.push({
    localId,
    pending_order_local_id,
    order_temp_id,
    user_email,
    comment,
    created_at: created_at || new Date().toISOString(),
  });
  writePendingHistoryItems(items);
}

export function pendingHistoryDisplayRows() {
  return readPendingHistoryQueue().map((h) => ({
    created_at: h.created_at,
    user_email: h.user_email,
    comment: h.comment,
    order_id: h.order_temp_id,
    __offlinePendingSync: true,
    __offlineLocalId: h.localId,
  }));
}

export function mergeOrderHistoryRows(serverRows) {
  const server = (serverRows || []).map((r) => ({ ...r }));
  const pending = [...pendingHistoryDisplayRows(), ...pendingServerEditHistoryDisplayRows()];
  const key = (r) => `${r.created_at}|${r.order_id}|${r.user_email}|${(r.comment || "").slice(0, 80)}`;
  const seen = new Set(server.map((r) => key(r)));
  const extras = pending.filter((p) => !seen.has(key(p)));
  const merged = [...extras, ...server];
  merged.sort((a, b) => {
    const ap = a.__offlinePendingSync ? 1 : 0;
    const bp = b.__offlinePendingSync ? 1 : 0;
    if (ap !== bp) return bp - ap;
    const ta = new Date(a.created_at || 0).getTime();
    const tb = new Date(b.created_at || 0).getTime();
    return tb - ta;
  });
  return merged;
}

async function flushPendingHistoryForSyncedOrder(serverOrderId, pendingOrderLocalId, userEmailFallback) {
  const all = readPendingHistoryQueue();
  const toFlush = all.filter((x) => x.pending_order_local_id === pendingOrderLocalId);
  const rest = all.filter((x) => x.pending_order_local_id !== pendingOrderLocalId);
  for (const h of toFlush) {
    const { error } = await supabaseClient.from("order_history").insert([
      {
        order_id: serverOrderId,
        user_email: h.user_email || userEmailFallback,
        comment: h.comment,
      },
    ]);
    if (error) console.warn("offline sync order_history:", error);
  }
  writePendingHistoryItems(rest);
  return toFlush.length > 0;
}

/* ---------- pending: calculations ---------- */

function readPendingCalcsQueue() {
  const o = readJson(PENDING_CALCS_KEY, { version: PENDING_VERSION, items: [] });
  if (!o || o.version !== PENDING_VERSION) return [];
  return Array.isArray(o.items) ? o.items : [];
}

function writePendingCalcsItems(items) {
  writeJson(PENDING_CALCS_KEY, { version: PENDING_VERSION, items });
}

export function addPendingOfflineCalculation({ localId, tempCalcId, insertPayload }) {
  const items = readPendingCalcsQueue();
  items.push({
    localId,
    tempCalcId,
    insertPayload: { ...insertPayload },
  });
  writePendingCalcsItems(items);
}

export function removePendingCalcByLocalId(localId) {
  writePendingCalcsItems(readPendingCalcsQueue().filter((x) => x.localId !== localId));
}

export function removePendingCalcByTempId(tempCalcId) {
  writePendingCalcsItems(readPendingCalcsQueue().filter((x) => x.tempCalcId !== tempCalcId));
}

export function pendingCalculationDisplayRows() {
  return readPendingCalcsQueue().map((c) => {
    const p = c.insertPayload || {};
    return {
      id: c.tempCalcId,
      created_at: p.created_at || new Date().toISOString(),
      from_place: p.from_place,
      to_place: p.to_place,
      amount: p.amount,
      comment: p.comment,
      deleted_at: null,
      __offlinePendingSync: true,
      __offlineLocalId: c.localId,
    };
  });
}

export function mergeCalculationRows(serverRows) {
  const server = (serverRows || []).map((r) => ({ ...r }));
  const pendingIds = new Set(server.map((r) => String(r.id)));
  const extras = pendingCalculationDisplayRows().filter((p) => !pendingIds.has(String(p.id)));
  const merged = [...extras, ...server];
  merged.sort((a, b) => {
    const ap = a.__offlinePendingSync ? 1 : 0;
    const bp = b.__offlinePendingSync ? 1 : 0;
    if (ap !== bp) return bp - ap;
    const ta = new Date(a.created_at || 0).getTime();
    const tb = new Date(b.created_at || 0).getTime();
    return tb - ta;
  });
  return merged;
}

async function syncPendingTasksToSupabase() {
  const items = readPendingTasksQueue();
  const remaining = [];
  for (const t of items) {
    const { error } = await supabaseClient.from("order_tasks").insert({
      author_login: t.author_login,
      body: t.body,
      executor_emails: Array.isArray(t.executor_emails) ? t.executor_emails : [],
      due_at: t.due_at || null,
      is_completed: t.is_completed === true,
      order_id: t.order_id ?? null,
      source_message_id: t.source_message_id ?? null,
      source_message_kind: t.source_message_kind || null,
    });
    if (error) {
      console.error("offline sync task:", error);
      remaining.push(t);
    }
  }
  writePendingTasksItems(remaining);
}

function isUniqueViolationError(err) {
  const code = err?.code;
  const msg = String(err?.message || "");
  return code === "23505" || /duplicate key|unique constraint|violates unique/i.test(msg);
}

async function syncPendingCalcsToSupabase(negOrderIdToServerId) {
  const items = readPendingCalcsQueue();
  const remaining = [];
  for (const c of items) {
    const payload = { ...c.insertPayload };
    if (typeof payload.order_id === "number" && payload.order_id < 0) {
      const sid = negOrderIdToServerId[payload.order_id];
      if (sid == null) {
        remaining.push(c);
        continue;
      }
      payload.order_id = sid;
    }
    const { error } = await supabaseClient.from("calculations").insert([payload]);
    if (error) {
      if (isUniqueViolationError(error)) {
        // Уже вставлено ранее (например, повторная попытка после таймаута).
        // Убираем из очереди, чтобы не застрять на постоянных 23505.
        continue;
      }
      console.error("offline sync calculation:", error);
      remaining.push(c);
    }
  }
  writePendingCalcsItems(remaining);
}

async function flushOnePendingServerOrderEdit(item) {
  const orderId = Number(item.orderId);
  const edits = Array.isArray(item.edits) ? item.edits : [];
  if (!Number.isFinite(orderId) || orderId <= 0 || edits.length === 0) return true;

  const { data: histRows, error: histErr } = await supabaseClient
    .from("order_history")
    .select("created_at, comment")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (histErr) throw histErr;

  const remoteHistory = [...(histRows || [])];
  const sortedEdits = [...edits].sort((a, b) => String(a.changedAt).localeCompare(String(b.changedAt)));
  const patch = {};

  for (const edit of sortedEdits) {
    const remoteAfterEdit = buildRemoteFieldChangeTimesAfter(remoteHistory, edit.changedAt);
    const changedKeys = getChangedOrderFieldKeys(edit.prevSnapshot, edit.orderData);
    for (const key of changedKeys) {
      if (remoteAfterEdit[key]) continue;
      patch[key] = edit.orderData[key];
    }
    const comments = normalizePendingHistoryComments(edit).filter(
      (c) => c && c !== "Сохранено без изменений",
    );
    if (comments.length === 0) continue;
    const rows = comments.map((comment) => ({
      order_id: orderId,
      user_email: edit.user_email,
      comment,
      created_at: edit.changedAt,
    }));
    const { error: insErr } = await supabaseClient.from("order_history").insert(rows);
    if (insErr && !isUniqueViolationError(insErr)) throw insErr;
    for (const comment of comments) {
      remoteHistory.push({ created_at: edit.changedAt, comment });
    }
  }

  const updatePayload = insertPayloadFromFormData(patch);
  if (Object.keys(updatePayload).length > 0) {
    const { error: updErr } = await supabaseClient.from("orders").update(updatePayload).eq("id", orderId);
    if (updErr) throw updErr;
  }
  return true;
}

/** Отправить в Supabase очередь правок существующих заказов (с разрешением конфликтов по полям). */
export async function syncPendingServerOrderEditsToSupabase() {
  const items = readPendingOrderEditsQueue();
  if (items.length === 0) return { synced: 0, failed: 0 };

  const remaining = [];
  let synced = 0;
  let failed = 0;
  for (const item of items) {
    try {
      const ok = await flushOnePendingServerOrderEdit(item);
      if (ok) synced += 1;
      else {
        failed += 1;
        remaining.push(item);
      }
    } catch (e) {
      console.error("offline sync server order edit:", e);
      failed += 1;
      remaining.push(item);
    }
  }
  writePendingOrderEditsItems(remaining);
  return { synced, failed };
}

/**
 * Вставить офлайн-заказы, привязанную историю, затем задачи и расчёты с подменой временных id заказов.
 */
export async function syncPendingOfflineDataToSupabase() {
  if (!isOfflineWorkModeEnabled()) {
    return { ordersSynced: 0, ordersFailed: 0 };
  }
  await syncPendingServerOrderEditsToSupabase();

  const orderItems = readPendingQueue();
  if (orderItems.length === 0) {
    const negMap = {};
    await syncPendingTasksToSupabase();
    await syncPendingCalcsToSupabase(negMap);
    return { ordersSynced: 0, ordersFailed: 0 };
  }

  let ordersSynced = 0;
  let ordersFailed = 0;
  const remainingOrders = [];
  const negOrderIdToServerId = {};
  const email = state.currentUser?.email;

  for (const item of orderItems) {
    const payload = insertPayloadFromFormData(item.insertPayload || item.displayRow || {});
    const { data, error } = await insertOrUpsertNewOrder(payload, payload.save_idempotency_key);

    if (error || !data) {
      console.error("offline sync insert failed:", error);
      remainingOrders.push(item);
      ordersFailed += 1;
      continue;
    }

    ordersSynced += 1;
    const newId = data.id;
    const negId = item.displayRow?.id;
    if (typeof negId === "number" && negId < 0) {
      negOrderIdToServerId[negId] = newId;
    }

    const hadHistory = await flushPendingHistoryForSyncedOrder(newId, item.localId, email);
    if (!hadHistory && newId != null && email) {
      const { error: histErr } = await supabaseClient.from("order_history").insert([
        {
          order_id: newId,
          user_email: email,
          comment: "Заказ создан без связи с базой и отправлен при появлении сети",
        },
      ]);
      if (histErr) console.warn("offline sync history fallback:", histErr);
    }
  }

  writePendingOrderItems(remainingOrders);
  await syncPendingTasksToSupabase();
  await syncPendingCalcsToSupabase(negOrderIdToServerId);

  return { ordersSynced, ordersFailed };
}

/** @deprecated используйте syncPendingOfflineDataToSupabase */
export async function syncPendingOfflineOrdersToSupabase() {
  const r = await syncPendingOfflineDataToSupabase();
  return { synced: r.ordersSynced, failed: r.ordersFailed };
}
