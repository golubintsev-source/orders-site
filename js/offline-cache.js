import { supabaseClient } from "./config.js";
import { state } from "./state.js";

const SNAP_KEY = "orders_site_offline_snap_v1";
const PENDING_ORDERS_KEY = "orders_site_offline_pending_v1";
const PENDING_TASKS_KEY = "orders_site_offline_pending_tasks_v1";
const PENDING_HISTORY_KEY = "orders_site_offline_pending_history_v1";
const PENDING_CALCS_KEY = "orders_site_offline_pending_calcs_v1";
/** Последний отображаемый список заказов (для F5 без сети, даже если основной snap пуст). */
const EMERGENCY_ORDERS_KEY = "orders_site_emergency_orders_v1";

const SNAP_VERSION = 1;
const PENDING_VERSION = 1;

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(key, val) {
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
  delete o.__offlinePendingSync;
  return o;
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
  if (state.ordersFromCache) return true;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return false;
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
export const OFFLINE_SUPABASE_WAIT_MS = 6000;

export function raceWithTimeout(promise, ms = OFFLINE_SUPABASE_WAIT_MS) {
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

export function mergeServerOrdersWithPendingDisplayRows(serverOrders) {
  const server = (serverOrders || []).map((row) => stripOfflineMeta({ ...row }));
  const pending = pendingDisplayRows();
  const serverIds = new Set(server.map((s) => String(s.id)));
  const extras = pending.filter((p) => p.id != null && !serverIds.has(String(p.id)));
  return sortOrdersWithOfflinePendingFirst([...extras, ...server]);
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

export function addPendingOfflineTask({ localId, tempTaskId, order_id, author_login, body, created_at }) {
  const items = readPendingTasksQueue();
  items.push({
    localId,
    tempTaskId,
    order_id,
    author_login,
    body,
    created_at: created_at || new Date().toISOString(),
  });
  writePendingTasksItems(items);
}

export function removePendingTaskByLocalId(localId) {
  writePendingTasksItems(readPendingTasksQueue().filter((x) => x.localId !== localId));
}

export function pendingTaskDisplayRows() {
  return readPendingTasksQueue().map((t) => ({
    id: t.tempTaskId,
    order_id: t.order_id,
    author_login: t.author_login,
    body: t.body,
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
  const pending = pendingHistoryDisplayRows();
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

async function syncPendingTasksToSupabase(negOrderIdToServerId) {
  const items = readPendingTasksQueue();
  const remaining = [];
  for (const t of items) {
    const sid = negOrderIdToServerId[t.order_id];
    if (sid == null) {
      remaining.push(t);
      continue;
    }
    const { error } = await supabaseClient.from("order_tasks").insert({
      order_id: sid,
      author_login: t.author_login,
      body: t.body,
    });
    if (error) {
      console.error("offline sync task:", error);
      remaining.push(t);
    }
  }
  writePendingTasksItems(remaining);
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
      console.error("offline sync calculation:", error);
      remaining.push(c);
    }
  }
  writePendingCalcsItems(remaining);
}

/**
 * Вставить офлайн-заказы, привязанную историю, затем задачи и расчёты с подменой временных id заказов.
 */
export async function syncPendingOfflineDataToSupabase() {
  const orderItems = readPendingQueue();
  if (orderItems.length === 0) {
    const negMap = {};
    await syncPendingTasksToSupabase(negMap);
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
    const { data, error } = await supabaseClient.from("orders").insert([payload]).select().single();

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
  await syncPendingTasksToSupabase(negOrderIdToServerId);
  await syncPendingCalcsToSupabase(negOrderIdToServerId);

  return { ordersSynced, ordersFailed };
}

/** @deprecated используйте syncPendingOfflineDataToSupabase */
export async function syncPendingOfflineOrdersToSupabase() {
  const r = await syncPendingOfflineDataToSupabase();
  return { synced: r.ordersSynced, failed: r.ordersFailed };
}
