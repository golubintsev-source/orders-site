import { supabaseClient, isOfflineWorkModeEnabled } from "./config.js";
import { syncDbUnavailableBanner } from "./dbHealth.js";
import { state } from "./state.js";
import { fetchAllSupabaseRows } from "./supabase-fetch.js";
import {
  clientSearch,
  setMessage,
  setOrderFormInvalidDateMessage,
  submitBtn,
  submitBtnTop,
  formTitle,
  cancelEditBtn,
  cancelEditBtnTop,
} from "./dom.js";
import {
  switchSection,
  refreshSectionNavLabel,
  updateSectionNavRicherStat,
  getCurrentSectionId,
  STANDALONE_SECTION_NAV_ID,
} from "./section-nav.js";
import { markSkipUserPlaceResume, rememberUserPlaceNow, scheduleSaveUserPlace } from "./user-place.js";
import { pathForRouteSection, syncOrderIdInUrl } from "./app-routes.js";
import { logOrderPageAccess } from "./access-log.js";
import { hideOrderViewQr, showOrderViewQr } from "./order-qr.js";
import {
  loadFilesCountMap,
  getFilesWord,
  uploadFiles,
  resetFileUpload,
  clearExistingOrderFilesInForm,
  renderExistingOrderFilesInForm,
} from "./files.js";
import {
  formatAmount,
  formatAmountWholeRubles,
  formatOrderIdTypeChip,
  formatDateShortRU,
  isValidOrderPhone,
  normalizeOrderPhone,
  tryParseRublesInteger,
  MSG_SUM_INTEGER_ONLY,
} from "./format.js";
import { applyOrdersTableMobileFit } from "./ordersTableMobileFit.js";
import {
  canMutateOrders,
  canDeleteOrders,
  canSelectKassaBeznal,
  KASSA_BEZNAL_PLACES,
  isAdmin,
  isOrderEditLockedForUserLite,
  isOrderHiddenForCurrentRole,
  isShopOrder,
  isUserLite,
  isUserShop,
} from "./roles.js";
import {
  readSnapshot,
  readPendingQueue,
  mergeServerOrdersWithPendingDisplayRows,
  persistServerOrdersForOffline,
  syncPendingOfflineDataToSupabase,
  addPendingOfflineOrderHistory,
  shouldSaveNewOrderToLocalQueue,
  isOfflineClientOrderId,
  addPendingOfflineOrder,
  updatePendingOfflineOrder,
  removePendingByLocalId,
  buildDisplayRowForPendingOrder,
  insertPayloadFromFormData,
  nextOfflineTempOrderId,
  nextOfflineTempCalcId,
  addPendingOfflineCalculation,
  cloneOrderWithoutOfflineMeta,
  sortOrdersWithOfflinePendingFirst,
  isNetworkFetchError,
  isOfflineDataMode,
  isBrowserOffline,
  shouldFallbackSaveOrderToLocal,
  persistEmergencyOrdersView,
  readEmergencyOrdersBaseForMerge,
  readPendingOrderEditsQueue,
  addOrAppendPendingServerOrderEdit,
  raceWithTimeout,
} from "./offline-cache.js";
import { shortLoginByEmail } from "./user-names.js";
import { getEditors } from "./settings.js";

function mergedLocalOrdersForOfflineDisplayMeta() {
  const snap = readSnapshot();
  const merged = mergeServerOrdersWithPendingDisplayRows(snap?.orders || []);
  if (merged.length > 0 || readPendingQueue().length > 0 || readPendingOrderEditsQueue().length > 0) {
    return { rows: merged, fromSnap: true };
  }
  const rows = mergeServerOrdersWithPendingDisplayRows(readEmergencyOrdersBaseForMerge());
  return { rows, fromSnap: false };
}

function mergedLocalOrdersForOfflineDisplay() {
  return mergedLocalOrdersForOfflineDisplayMeta().rows;
}

const SESSION_ORDERS_CACHE_KEY = "orders_site_session_orders_v1";
const SESSION_FILES_COUNT_CACHE_KEY = "orders_site_session_files_count_v1";
/** Долгоживущий кэш для мгновенного открытия PWA после убийства WebView (iOS). */
const LOCAL_ORDERS_CACHE_KEY = "orders_site_local_orders_v1";
const LOCAL_FILES_COUNT_CACHE_KEY = "orders_site_local_files_count_v1";

/** 7 и +7 → 8 в phone (отображение и последующее сохранение). */
function normalizeOrdersPhones(orders) {
  if (!Array.isArray(orders)) return orders;
  return orders.map((o) => {
    if (!o || o.phone == null || o.phone === "") return o;
    const phone = normalizeOrderPhone(o.phone);
    if (!phone || phone === o.phone) return o;
    return { ...o, phone };
  });
}

function persistOrdersSessionCache(orders, filesCountMap) {
  try {
    sessionStorage.setItem(SESSION_ORDERS_CACHE_KEY, JSON.stringify(orders));
    sessionStorage.setItem(SESSION_FILES_COUNT_CACHE_KEY, JSON.stringify(filesCountMap || {}));
  } catch {
    /* ignore quota */
  }
  try {
    localStorage.setItem(LOCAL_ORDERS_CACHE_KEY, JSON.stringify(orders));
    localStorage.setItem(LOCAL_FILES_COUNT_CACHE_KEY, JSON.stringify(filesCountMap || {}));
  } catch {
    /* ignore quota */
  }
}

function paintOrdersFromCacheRaw(ordersRaw, filesCountRaw) {
  if (!ordersRaw) return false;
  const orders = JSON.parse(ordersRaw);
  if (!Array.isArray(orders) || orders.length === 0) return false;
  state.allOrders = normalizeOrdersPhones(orders);
  state.filesCountMap = filesCountRaw ? JSON.parse(filesCountRaw) : {};
  applyFiltersAndRender();
  updateSectionNavRicherStat();
  return true;
}

/** Мгновенная отрисовка таблицы из sessionStorage (stale-while-revalidate). */
export function paintOrdersFromSessionCacheIfAny() {
  try {
    paintOrdersFromCacheRaw(
      sessionStorage.getItem(SESSION_ORDERS_CACHE_KEY),
      sessionStorage.getItem(SESSION_FILES_COUNT_CACHE_KEY),
    );
  } catch {
    /* ignore */
  }
}

/** Мгновенная отрисовка после холодного старта PWA, если sessionStorage пуст. */
export function paintOrdersFromLocalCacheIfAny() {
  if (state.allOrders?.length) return;
  try {
    paintOrdersFromCacheRaw(
      localStorage.getItem(LOCAL_ORDERS_CACHE_KEY),
      localStorage.getItem(LOCAL_FILES_COUNT_CACHE_KEY),
    );
  } catch {
    /* ignore */
  }
}

function refreshFilesCountMapInBackground() {
  void loadFilesCountMap().then(() => {
    if (!state.allOrders.length) return;
    applyFiltersAndRender();
    persistOrdersSessionCache(state.allOrders, state.filesCountMap);
  });
}

/**
 * Сразу после входа: таблица из localStorage без ожидания сети (Safari/iOS).
 * При navigator.onLine === false сразу включает офлайн-режим (F5 без сети).
 */
export function paintOrdersFromLocalStorageIfAny() {
  if (!isOfflineWorkModeEnabled()) return;
  const rows = mergedLocalOrdersForOfflineDisplay();
  if (rows.length > 0) {
    state.allOrders = normalizeOrdersPhones(rows);
    state.filesCountMap = state.filesCountMap || {};
    applyFiltersAndRender();
    updateSectionNavRicherStat();
  }
  if (isBrowserOffline()) {
    state.ordersFromCache = true;
    state.dbUnavailable = true;
    syncDbUnavailableBanner();
  }
}

/** Вызывается при подтверждённой недоступности БД (пинг): переключить UI на локальную копию. */
export function applyOfflineModeFromDbUnavailable() {
  if (!isOfflineWorkModeEnabled()) return;
  state.dbUnavailable = true;
  if (state.ordersFromCache) {
    syncDbUnavailableBanner();
    return;
  }
  const { rows: merged } = mergedLocalOrdersForOfflineDisplayMeta();
  if (merged.length > 0) {
    state.ordersFromCache = true;
    state.allOrders = normalizeOrdersPhones(merged);
    persistEmergencyOrdersView(state.allOrders);
    state.filesCountMap = {};
    syncDbUnavailableBanner();
    applyFiltersAndRender();
    updateSectionNavRicherStat();
    return;
  }
  if (state.allOrders.length > 0) {
    state.ordersFromCache = true;
    syncDbUnavailableBanner();
    return;
  }
  syncDbUnavailableBanner();
}

function refreshOrdersDependentSections() {
  if (getCurrentSectionId() === "tasks-all") {
    refreshSectionNavLabel();
    void import("./tasks.js").then((m) => m.loadAllTasks());
  } else if (getCurrentSectionId() === "changes-all") {
    void import("./all-changes.js").then((m) => m.loadAllChanges());
  } else if (getCurrentSectionId() === "order-tasks") {
    refreshSectionNavLabel();
    void import("./tasks.js").then((m) => m.loadOrderTasks());
  } else if (getCurrentSectionId() === "route-sheet") {
    void import("./route-sheet.js").then((m) => m.loadRouteSheet());
  }
}

/** Колонки для списка/фильтров/маршрутного листа — без select("*"), меньше JSON и быстрее ответ. */
const ORDERS_LIST_SELECT = [
  "id",
  "order_date",
  "client",
  "phone",
  "address",
  "description",
  "payment_status",
  "amount",
  "prepayment",
  "prepayment_to",
  "remaining_amount",
  "remaining_to",
  "delivery",
  "delivery_date",
  "installation",
  "installation_date",
  "area_m2",
  "installer_payment_amount",
  "installer_payment_by",
  "installer_rate_per_m2",
  "installer_name",
  "reveals",
  "reveals_date",
  "mosquito_nets",
  "construction_count",
  "order_type",
  "order_number",
  "lock_edit_for_user_lite",
  "tasks_highlight",
  "coordinates",
].join(",");

/** Первая отрисовка: только заказы за последние N календарных дней (включая сегодня). */
const ORDERS_FAST_LOAD_DAYS = 3;

/** Поколение loadOrders — отменяет устаревшие фоновые догрузки. */
let loadOrdersGeneration = 0;

/** YYYY-MM-DD: начало окна «последние days» (сегодня и days-1 предыдущих). */
function getOrdersFastLoadSinceYmd(days = ORDERS_FAST_LOAD_DAYS) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - Math.max(0, days - 1));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function fetchOrdersFromDb({ sinceOrderDateYmd = null } = {}) {
  const buildListQuery = () => {
    let query = supabaseClient
      .from("orders")
      .select(ORDERS_LIST_SELECT)
      .is("deleted_at", null)
      .order("id", { ascending: false });
    if (sinceOrderDateYmd) {
      query = query.gte("order_date", sinceOrderDateYmd);
    }
    return query;
  };

  let { data, error } = await fetchAllSupabaseRows(buildListQuery);

  if (error) {
    const buildStarQuery = () => {
      let again = supabaseClient
        .from("orders")
        .select("*")
        .is("deleted_at", null)
        .order("id", { ascending: false });
      if (sinceOrderDateYmd) {
        again = again.gte("order_date", sinceOrderDateYmd);
      }
      return again;
    };
    const againStar = await fetchAllSupabaseRows(buildStarQuery);
    if (!againStar.error) {
      data = againStar.data;
      error = null;
    } else {
      error = againStar.error || error;
    }
  }

  return { data, error };
}

function commitOrdersToUi(rawOrders, { persistCache = true } = {}) {
  state.dbUnavailable = false;
  let finalData = rawOrders || [];
  if (isOfflineWorkModeEnabled()) {
    finalData = mergeServerOrdersWithPendingDisplayRows(finalData);
    persistServerOrdersForOffline(rawOrders || []);
    persistEmergencyOrdersView(finalData);
  }
  state.ordersFromCache = false;
  state.allOrders = normalizeOrdersPhones(finalData);
  syncDbUnavailableBanner();
  applyFiltersAndRender();
  updateSectionNavRicherStat();
  refreshOrdersDependentSections();
  if (persistCache) {
    persistOrdersSessionCache(state.allOrders, state.filesCountMap);
  }
  refreshFilesCountMapInBackground();
}

function applyOrdersLoadError(error) {
  console.error("Ошибка загрузки:", error);

  if (!isOfflineWorkModeEnabled()) {
    state.dbUnavailable = false;
    state.ordersFromCache = false;
    state.allOrders = [];
    state.filesCountMap = {};
    syncDbUnavailableBanner();
    applyFiltersAndRender();
    updateSectionNavRicherStat();
    setMessage("Ошибка загрузки заявок", "#d32f2f");
    refreshOrdersDependentSections();
    return;
  }

  state.dbUnavailable = true;
  const { rows: merged, fromSnap } = mergedLocalOrdersForOfflineDisplayMeta();

  if (merged.length > 0) {
    state.ordersFromCache = true;
    state.allOrders = normalizeOrdersPhones(merged);
    persistEmergencyOrdersView(state.allOrders);
    state.filesCountMap = {};
    syncDbUnavailableBanner();
    applyFiltersAndRender();
    updateSectionNavRicherStat();
    setMessage(
      fromSnap
        ? "Нет связи с базой. Открыта последняя копия с этого устройства; новые заявки сохраняются локально и отправятся при появлении связи."
        : "Нет связи с базой. Восстановлен последний сохранённый на этом устройстве список заказов (офлайн-очередь подмешана).",
      "#92400e"
    );
    refreshOrdersDependentSections();
    return;
  }

  syncDbUnavailableBanner();
  state.ordersFromCache = false;
  state.allOrders = [];
  state.filesCountMap = {};
  applyFiltersAndRender();
  updateSectionNavRicherStat();
  setMessage("Ошибка загрузки заявок", "#d32f2f");
  refreshOrdersDependentSections();
}

/**
 * Быстрый старт: сначала заказы за 3 дня → сразу таблица,
 * затем в фоне — полный список.
 * Если уже есть кэш на экране — не сжимаем таблицу до 3 дней, сразу догружаем полное.
 */
export async function loadOrders() {
  const gen = ++loadOrdersGeneration;
  const hadPaintedCache = Array.isArray(state.allOrders) && state.allOrders.length > 0;

  if (isOfflineWorkModeEnabled()) {
    try {
      await syncPendingOfflineDataToSupabase();
    } catch (e) {
      console.warn("Офлайн-синхронизация перед загрузкой заказов:", e);
    }
  }

  if (!hadPaintedCache) {
    const recent = await fetchOrdersFromDb({ sinceOrderDateYmd: getOrdersFastLoadSinceYmd() });
    if (gen !== loadOrdersGeneration) return;
    if (!recent.error && recent.data) {
      commitOrdersToUi(recent.data, { persistCache: false });
      void loadOrdersFullInBackground(gen);
      return;
    }
    // Быстрый запрос не удался — ниже полный / ошибка.
    if (recent.error) {
      console.warn("Быстрая загрузка заказов (3 дня):", recent.error);
    }
  }

  const all = await fetchOrdersFromDb({});
  if (gen !== loadOrdersGeneration) return;

  if (!all.error && all.data) {
    commitOrdersToUi(all.data, { persistCache: true });
    return;
  }

  if (hadPaintedCache) {
    console.error("Ошибка фоновой/полной загрузки заказов:", all.error);
    return;
  }
  applyOrdersLoadError(all.error);
}

async function loadOrdersFullInBackground(gen) {
  const all = await fetchOrdersFromDb({});
  if (gen !== loadOrdersGeneration) return;
  if (!all.error && all.data) {
    commitOrdersToUi(all.data, { persistCache: true });
    return;
  }
  console.error("Ошибка полной загрузки заказов:", all.error);
}

const STATUS_OPTIONS = [
  "Контакт с клиентом",
  "Замер назначен",
  "Замер проведен",
  "Расчет сформирован",
  "Предложение направлено",
  "Клиент согласен",
  "Производство",
  "Товар передан заказчику",
  "Монтаж выполнен",
  "Заказ закрыт",
];

/** По умолчанию в таблице заказов не показывать закрытые; «Все» в фильтре сбрасывает на полный список. */
state.statusFilterSelected = STATUS_OPTIONS.filter((s) => s !== "Заказ закрыт");

/** Значения фильтра колонки «Опл.» (да / нет / без указанной суммы заказа). */
const PAID_FILTER_OPTIONS = ["да", "нет", "Без суммы"];

function normalizeStatus(val) {
  if (val === "нет" || val === "оплачен" || val == null || val === "") return "Контакт с клиентом";
  return val;
}

/** Ключи фильтра у колонки «Номер» (тип заказа); __empty__ — без типа */
const ORDER_TYPE_FILTER_KEYS = ["__empty__", "Окна", "Подоконники", "Аллюминий", "Магазин", "Сетки/мелочь"];

function orderTypeFilterKeysForUi() {
  if (isUserShop()) {
    return ["Магазин"];
  }
  if (isUserLite()) {
    return ORDER_TYPE_FILTER_KEYS.filter((k) => k !== "Магазин");
  }
  return ORDER_TYPE_FILTER_KEYS;
}

function orderTypeFilterLabel(key) {
  return key === "__empty__" ? "Без типа" : key;
}

function orderMatchesOrderTypeKeys(order, selectedKeys) {
  if (!selectedKeys || selectedKeys.length === 0) return true;
  const t = (order.order_type || "").trim();
  return selectedKeys.some((key) => (key === "__empty__" ? t === "" : t === key));
}

const ORDER_FORM_NUMERIC_FIELD_DECIMALS = {
  amount: 0,
  prepayment: 0,
  remaining_amount: 0,
  area_m2: 2,
  mosquito_nets: 0,
  construction_count: 0,
  installer_rate_per_m2: 0,
  installer_payment_amount: 0,
};

/** Поля формы заказа: суммы в рублях только целые (без копеек). */
export const RUBLE_INTEGER_ORDER_FIELD_IDS = [
  "amount",
  "prepayment",
  "remaining_amount",
  "installer_payment_amount",
  "installer_rate_per_m2",
];

const ORDER_DELTA_CALC_COMMENT_PREFIX = "[AUTO_ORDER_DELTA]";
/** Пустое значение в теле автокомментария расчёта (клиент, адрес и т.п.). */
const CALC_COMMENT_EMPTY = "[__]";

/** Время чч:мм (локальное) для автокомментария в «Расчеты». */
function formatTimeHHmmFromIso(iso) {
  if (!iso) return "--:--";
  try {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mi}`;
  } catch {
    return "--:--";
  }
}

function toComparableNumber(v) {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Строки для вставки в calculations (автодельты по суммам/получателям заказа).
 * Без order_id — как при онлайн-insert; при офлайне каждая строка уходит в очередь pending.
 */
function buildOrderDeltaCalculationInsertRows({
  orderId,
  wasEditing,
  initialSums,
  initialParticipants,
  orderData,
}) {
  if (!orderId) return [];

  const nowIso = new Date().toISOString();
  const timeHHmm = formatTimeHHmmFromIso(nowIso);
  const actorShort = shortLoginByEmail(state.currentUser?.email);
  const orderNumberStr = formatOrderIdTypeChip(orderId, orderData?.order_type) || `#${orderId}`;
  const clientStr = (orderData?.client && String(orderData.client).trim()) || CALC_COMMENT_EMPTY;
  const addressStr = (orderData?.address && String(orderData.address).trim()) || CALC_COMMENT_EMPTY;
  const old = {
    prepayment: wasEditing ? toComparableNumber(initialSums?.prepayment) : 0,
    remaining_amount: wasEditing ? toComparableNumber(initialSums?.remaining_amount) : 0,
    installer_payment_amount: wasEditing ? toComparableNumber(initialSums?.installer_payment_amount) : 0,
  };
  const next = {
    prepayment: toComparableNumber(orderData?.prepayment),
    remaining_amount: toComparableNumber(orderData?.remaining_amount),
    installer_payment_amount: toComparableNumber(orderData?.installer_payment_amount),
  };

  const rows = [];

  const normRecipientSelect = (v) => {
    const t = String(v ?? "").trim();
    return t === "—" ? "" : t;
  };

  const pushAmountRecipientCalcRow = (kindLabel, { from_place, to_place, amount, delta_key, detail }) => {
    if (Math.abs(amount) < 0.000001) return;
    rows.push({
      created_at: nowIso,
      from_place: from_place || "—",
      to_place: to_place || "—",
      amount,
      comment: `${ORDER_DELTA_CALC_COMMENT_PREFIX} ${kindLabel}; ${orderNumberStr}; ${clientStr}; ${addressStr}; ${detail}; ${timeHHmm}; ${actorShort}`,
      order_id: orderId,
      delta_key,
    });
  };

  /**
   * Предоплата / Кому предоплата — та же схема, что для «Остаток» / «Кому остаток»:
   * пустой select и «—» = «-»; ветки 1–5 как для остатка.
   */
  const prepToBefore = normRecipientSelect(wasEditing ? initialParticipants?.prepayment_to : "");
  const prepToAfter = normRecipientSelect(orderData?.prepayment_to);
  const prepToBeforeEmpty = prepToBefore === "";
  const prepToAfterEmpty = prepToAfter === "";
  const prepOld = old.prepayment;
  const prepNew = next.prepayment;
  const prepSame = Math.abs(prepOld - prepNew) < 0.000001;
  const prepToSame = prepToBefore === prepToAfter;

  if (!(prepToBeforeEmpty && prepToAfterEmpty) && !(prepSame && prepToSame)) {
    if (prepToBeforeEmpty && !prepToAfterEmpty) {
      pushAmountRecipientCalcRow("Предоплата", {
        from_place: "Клиент",
        to_place: prepToAfter,
        amount: prepNew,
        delta_key: "prepayment",
        detail: `кому ${CALC_COMMENT_EMPTY} → ${prepToAfter}; сумма ${formatAmount(prepNew)}`,
      });
    } else if (!prepToBeforeEmpty && prepToAfterEmpty) {
      pushAmountRecipientCalcRow("Предоплата", {
        from_place: prepToBefore,
        to_place: "Клиент",
        amount: prepOld,
        delta_key: "prepayment",
        detail: `${prepToBefore} → клиент; сумма ${formatAmount(prepOld)}`,
      });
    } else if (!prepToBeforeEmpty && !prepToAfterEmpty && prepToSame) {
      pushAmountRecipientCalcRow("Предоплата", {
        from_place: "Клиент",
        to_place: prepToAfter,
        amount: prepNew - prepOld,
        delta_key: "prepayment",
        detail: `${prepToAfter}; ${formatAmount(prepOld)} → ${formatAmount(prepNew)}`,
      });
    } else if (!prepToBeforeEmpty && !prepToAfterEmpty && !prepToSame) {
      pushAmountRecipientCalcRow("Предоплата", {
        from_place: prepToBefore,
        to_place: "Клиент",
        amount: prepOld,
        delta_key: "prepayment_to",
        detail: `смена получателя; ${prepToBefore} → клиент; ${formatAmount(prepOld)}`,
      });
      pushAmountRecipientCalcRow("Предоплата", {
        from_place: "Клиент",
        to_place: prepToAfter,
        amount: prepNew,
        delta_key: "prepayment_to",
        detail: `смена получателя; клиент → ${prepToAfter}; ${formatAmount(prepNew)}`,
      });
    }
  }

  const remToBefore = normRecipientSelect(wasEditing ? initialParticipants?.remaining_to : "");
  const remToAfter = normRecipientSelect(orderData?.remaining_to);
  const remToBeforeEmpty = remToBefore === "";
  const remToAfterEmpty = remToAfter === "";

  const remOld = old.remaining_amount;
  const remNew = next.remaining_amount;
  const remSame = Math.abs(remOld - remNew) < 0.000001;
  const remToSame = remToBefore === remToAfter;

  /**
   * Остаток / Кому остаток — пустой select и «—» = «-»; ветки 1–5.
   */
  if (!(remToBeforeEmpty && remToAfterEmpty) && !(remSame && remToSame)) {
    if (remToBeforeEmpty && !remToAfterEmpty) {
      pushAmountRecipientCalcRow("Остаток", {
        from_place: "Клиент",
        to_place: remToAfter,
        amount: remNew,
        delta_key: "remaining_amount",
        detail: `кому ${CALC_COMMENT_EMPTY} → ${remToAfter}; сумма ${formatAmount(remNew)}`,
      });
    } else if (!remToBeforeEmpty && remToAfterEmpty) {
      pushAmountRecipientCalcRow("Остаток", {
        from_place: remToBefore,
        to_place: "Клиент",
        amount: remOld,
        delta_key: "remaining_amount",
        detail: `${remToBefore} → клиент; сумма ${formatAmount(remOld)}`,
      });
    } else if (!remToBeforeEmpty && !remToAfterEmpty && remToSame) {
      pushAmountRecipientCalcRow("Остаток", {
        from_place: "Клиент",
        to_place: remToAfter,
        amount: remNew - remOld,
        delta_key: "remaining_amount",
        detail: `${remToAfter}; ${formatAmount(remOld)} → ${formatAmount(remNew)}`,
      });
    } else if (!remToBeforeEmpty && !remToAfterEmpty && !remToSame) {
      pushAmountRecipientCalcRow("Остаток", {
        from_place: remToBefore,
        to_place: "Клиент",
        amount: remOld,
        delta_key: "remaining_to",
        detail: `смена получателя; ${remToBefore} → клиент; ${formatAmount(remOld)}`,
      });
      pushAmountRecipientCalcRow("Остаток", {
        from_place: "Клиент",
        to_place: remToAfter,
        amount: remNew,
        delta_key: "remaining_to",
        detail: `смена получателя; клиент → ${remToAfter}; ${formatAmount(remNew)}`,
      });
    }
  }

  /**
   * з/п монтаж / Оплатил — та же схема ветвлений, что для «Остаток» / «Кому остаток»,
   * но расход: движение «плательщик → Монтаж» (в остатке было «Клиент → получатель»).
   */
  const instByBefore = normRecipientSelect(wasEditing ? initialParticipants?.installer_payment_by : "");
  const instByAfter = normRecipientSelect(orderData?.installer_payment_by);
  const instByBeforeEmpty = instByBefore === "";
  const instByAfterEmpty = instByAfter === "";
  const instOld = old.installer_payment_amount;
  const instNew = next.installer_payment_amount;
  const instSame = Math.abs(instOld - instNew) < 0.000001;
  const instBySame = instByBefore === instByAfter;

  if (!(instByBeforeEmpty && instByAfterEmpty) && !(instSame && instBySame)) {
    if (instByBeforeEmpty && !instByAfterEmpty) {
      pushAmountRecipientCalcRow("Монтаж", {
        from_place: instByAfter,
        to_place: "Монтаж",
        amount: instNew,
        delta_key: "installer_payment_amount",
        detail: `оплатил ${CALC_COMMENT_EMPTY} → ${instByAfter}; сумма ${formatAmount(instNew)}`,
      });
    } else if (!instByBeforeEmpty && instByAfterEmpty) {
      pushAmountRecipientCalcRow("Монтаж", {
        from_place: "Монтаж",
        to_place: instByBefore,
        amount: instOld,
        delta_key: "installer_payment_amount",
        detail: `Монтаж → ${instByBefore}; сумма ${formatAmount(instOld)}`,
      });
    } else if (!instByBeforeEmpty && !instByAfterEmpty && instBySame) {
      pushAmountRecipientCalcRow("Монтаж", {
        from_place: instByAfter,
        to_place: "Монтаж",
        amount: instNew - instOld,
        delta_key: "installer_payment_amount",
        detail: `${instByAfter}; ${formatAmount(instOld)} → ${formatAmount(instNew)}`,
      });
    } else if (!instByBeforeEmpty && !instByAfterEmpty && !instBySame) {
      pushAmountRecipientCalcRow("Монтаж", {
        from_place: "Монтаж",
        to_place: instByBefore,
        amount: instOld,
        delta_key: "installer_payment_by",
        detail: `смена плательщика; Монтаж → ${instByBefore}; ${formatAmount(instOld)}`,
      });
      pushAmountRecipientCalcRow("Монтаж", {
        from_place: instByAfter,
        to_place: "Монтаж",
        amount: instNew,
        delta_key: "installer_payment_by",
        detail: `смена плательщика; ${instByAfter} → Монтаж; ${formatAmount(instNew)}`,
      });
    }
  }

  if (rows.length === 0) return [];

  return rows.map((r) => ({
    created_at: r.created_at,
    from_place: r.from_place,
    to_place: r.to_place,
    amount: r.amount,
    comment: r.comment,
  }));
}

async function writeOrderDeltaCalculations({
  orderId,
  wasEditing,
  initialSums,
  initialParticipants,
  orderData,
}) {
  const payload = buildOrderDeltaCalculationInsertRows({
    orderId,
    wasEditing,
    initialSums,
    initialParticipants,
    orderData,
  });
  if (payload.length === 0) return;
  const { error } = await supabaseClient.from("calculations").insert(payload);
  if (error) {
    console.error("Автозапись дельт в calculations:", error);
  }
}

function queueOrderDeltaCalculationsForOffline({
  orderTempId,
  wasEditing,
  initialSums,
  initialParticipants,
  orderData,
}) {
  const rows = buildOrderDeltaCalculationInsertRows({
    orderId: orderTempId,
    wasEditing,
    initialSums,
    initialParticipants,
    orderData,
  });
  for (const insertPayload of rows) {
    const localId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `calc-delta-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    addPendingOfflineCalculation({
      localId,
      tempCalcId: nextOfflineTempCalcId(),
      insertPayload,
    });
  }
}

/** В полях даты формы заказа год по маске 20** — 2000–2099 (ровно 4 цифры, префикс «20»). */
const ORDER_FORM_DATE_YEAR_MIN = 2000;
const ORDER_FORM_DATE_YEAR_MAX = 2099;

/** Только цифры из строки дд.мм.гггг (до 8 шт.). */
function orderFormDateDigitsOnly(raw) {
  return String(raw || "").replace(/\D/g, "").slice(0, 8);
}

/** Форматирует до 8 цифр в дд.мм.гггг с точками. */
function formatOrderFormDdMmYyyyFromDigits(digits) {
  const d = orderFormDateDigitsOnly(digits);
  if (d.length === 0) return "";
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}.${d.slice(2)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4)}`;
}

/**
 * Полная дата дд.мм.гггг → yyyy-mm-dd или null (календарная проверка; год 2000–2099).
 */
export function parseOrderFormDdMmYyyyToIso(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  const dd = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  let yyyy = parseInt(m[3], 10);
  if (Number.isNaN(dd) || Number.isNaN(mm) || Number.isNaN(yyyy)) return null;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  if (yyyy < ORDER_FORM_DATE_YEAR_MIN || yyyy > ORDER_FORM_DATE_YEAR_MAX) return null;
  const dt = new Date(yyyy, mm - 1, dd);
  if (dt.getFullYear() !== yyyy || dt.getMonth() !== mm - 1 || dt.getDate() !== dd) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${yyyy}-${pad(mm)}-${pad(dd)}`;
}

/** В поле непусто, но строка не является полной корректной дд.мм.гггг. */
function hasInvalidOrderFormDateInput() {
  const nonEmptyInvalid = (id) => {
    const raw = (document.getElementById(id)?.value || "").trim();
    if (!raw) return false;
    return !parseOrderFormDdMmYyyyToIso(raw);
  };
  if (nonEmptyInvalid("order_date")) return true;
  if (nonEmptyInvalid("delivery_date")) return true;
  if (document.getElementById("installation")?.checked && nonEmptyInvalid("installation_date")) return true;
  if (document.getElementById("reveals")?.checked && nonEmptyInvalid("reveals_date")) return true;
  return false;
}

function dateFieldShouldValidate(textFieldId) {
  if (textFieldId === "installation_date") return Boolean(document.getElementById("installation")?.checked);
  if (textFieldId === "reveals_date") return Boolean(document.getElementById("reveals")?.checked);
  return true;
}

/**
 * Подсвечивает неверные даты красным.
 * @param {boolean} showAllInvalid если true — подсвечиваем любой непустой некорректный ввод,
 *                                  если false — подсвечиваем только когда введены все 8 цифр.
 */
export function updateOrderFormDateFieldHighlights(showAllInvalid = false) {
  const ids = ["order_date", "delivery_date", "installation_date", "reveals_date"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;

    const raw = (el.value || "").trim();
    const shouldValidate = dateFieldShouldValidate(id);

    if (!shouldValidate) {
      el.classList.remove("date-invalid");
      continue;
    }

    if (!raw) {
      el.classList.remove("date-invalid");
      continue;
    }

    if (!showAllInvalid) {
      const digitsCount = raw.replace(/\D/g, "").length;
      if (digitsCount < 8) {
        el.classList.remove("date-invalid");
        continue;
      }
    }

    const invalid = !parseOrderFormDdMmYyyyToIso(raw);
    el.classList.toggle("date-invalid", invalid);
  }
}

/**
 * Подгоняет год к диапазону 2000–2099, если строка уже в формате value у input.
 * @param {string} raw
 * @param {"date" | "datetime-local"} type
 */
export function normalizeOrderFormDateInputValue(raw, type) {
  if (raw == null || typeof raw !== "string") return raw;
  const trimmed = raw.trim();
  if (!trimmed) return raw;

  if (type === "datetime-local") {
    const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return raw;
    let y = parseInt(m[1], 10);
    if (Number.isNaN(y)) return raw;
    if (y < ORDER_FORM_DATE_YEAR_MIN) y = ORDER_FORM_DATE_YEAR_MIN;
    if (y > ORDER_FORM_DATE_YEAR_MAX) y = ORDER_FORM_DATE_YEAR_MAX;
    const yyyy = String(y);
    if (m[6] !== undefined) {
      return `${yyyy}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
    }
    return `${yyyy}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
  }

  const m2 = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m2) return raw;
  let y = parseInt(m2[1], 10);
  if (Number.isNaN(y)) return raw;
  if (y < ORDER_FORM_DATE_YEAR_MIN) y = ORDER_FORM_DATE_YEAR_MIN;
  if (y > ORDER_FORM_DATE_YEAR_MAX) y = ORDER_FORM_DATE_YEAR_MAX;
  return `${y}-${m2[2]}-${m2[3]}`;
}

/**
 * Читает поле даты (дд.мм.гггг или legacy yyyy-mm-dd), подгоняет год; при необходимости обновляет отображение.
 */
export function syncOrderFormDateFieldFromDom(id, type) {
  const el = document.getElementById(id);
  if (!el) return null;
  const v = (el.value || "").trim();
  if (!v) return null;
  if (type === "date") {
    const fromDots = parseOrderFormDdMmYyyyToIso(v);
    if (fromDots) {
      const next = normalizeOrderFormDateInputValue(fromDots, "date");
      const display = formatDateDDMMYYYY(next);
      if ((el.value || "").trim() !== display) el.value = display;
      return next;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const y = parseInt(v.slice(0, 4), 10);
      if (Number.isNaN(y) || y < ORDER_FORM_DATE_YEAR_MIN || y > ORDER_FORM_DATE_YEAR_MAX) return null;
      const next = normalizeOrderFormDateInputValue(v, "date");
      const display = formatDateDDMMYYYY(next);
      if ((el.value || "").trim() !== display) el.value = display;
      return next;
    }
    return null;
  }
  const next = normalizeOrderFormDateInputValue(v, type);
  if (next !== v) el.value = next;
  return next;
}

/** Собирает order_date + order_time в строку для БД (datetime-local по смыслу). */
export function syncOrderFormDateTimeFromDom() {
  const dateIso = syncOrderFormDateFieldFromDom("order_date", "date");
  const timeEl = document.getElementById("order_time");
  if (!dateIso) return null;
  const t = (timeEl?.value || "00:00").trim();
  const tm = t.match(/^(\d{2}):(\d{2})/);
  const hh = tm ? tm[1] : "00";
  const mi = tm ? tm[2] : "00";
  return normalizeOrderFormDateInputValue(`${dateIso}T${hh}:${mi}`, "datetime-local");
}

function orderFormDdMmYyyyInputHandler(el) {
  const prev = el.value;
  const selStart = el.selectionStart ?? 0;
  const digitsBefore = orderFormDateDigitsOnly(prev.slice(0, selStart)).length;
  const formatted = formatOrderFormDdMmYyyyFromDigits(prev);
  if (formatted !== prev) {
    el.value = formatted;
    let pos = 0;
    let d = 0;
    for (let i = 0; i < formatted.length && d < digitsBefore; i++) {
      if (/\d/.test(formatted[i])) d++;
      pos = i + 1;
    }
    el.setSelectionRange(pos, pos);
  }
}

function orderFormNativePickerId(textFieldId) {
  return `${textFieldId}_picker`;
}

/** Скрытый input[type=date] синхронизировать с дд.мм.гггг */
export function syncOrderFormTextFieldToNativePicker(textFieldId) {
  const textEl = document.getElementById(textFieldId);
  const picker = document.getElementById(orderFormNativePickerId(textFieldId));
  if (!textEl || !picker) return;
  const iso = parseOrderFormDdMmYyyyToIso((textEl.value || "").trim());
  picker.value = iso || "";
}

function applyNativePickerToOrderFormTextField(textFieldId) {
  const textEl = document.getElementById(textFieldId);
  const picker = document.getElementById(orderFormNativePickerId(textFieldId));
  if (!textEl || !picker) return;
  const v = (picker.value || "").trim();
  if (!v) return;
  const next = normalizeOrderFormDateInputValue(v, "date");
  textEl.value = formatDateDDMMYYYY(next);
  textEl.dispatchEvent(new Event("input", { bubbles: true }));
  updateConditionalRequiredHighlight();
  if (textFieldId === "installation_date") updateInstallerBlockByInstallationDate();
}

/**
 * Перед открытием нативного календаря (в т.ч. на iOS — только прямой тап по input type=date).
 * Подставляет в picker текущую дату из поля или сегодняшнюю в допустимом диапазоне.
 */
function primeOrderFormNativePickerFromText(textFieldId) {
  const textEl = document.getElementById(textFieldId);
  const picker = document.getElementById(orderFormNativePickerId(textFieldId));
  if (!textEl || !picker) return;
  const existing = parseOrderFormDdMmYyyyToIso((textEl.value || "").trim());
  if (existing) {
    picker.value = existing;
  } else {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    let y = d.getFullYear();
    if (y < ORDER_FORM_DATE_YEAR_MIN) y = ORDER_FORM_DATE_YEAR_MIN;
    if (y > ORDER_FORM_DATE_YEAR_MAX) y = ORDER_FORM_DATE_YEAR_MAX;
    picker.value = `${y}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
}

function bindOrderFormDateCalendarPickers() {
  const ids = ["order_date", "delivery_date", "installation_date", "reveals_date"];
  for (const id of ids) {
    const picker = document.getElementById(orderFormNativePickerId(id));
    if (!picker) continue;
    const prime = () => primeOrderFormNativePickerFromText(id);
    picker.addEventListener("focus", prime);
    picker.addEventListener("touchstart", prime, { passive: true });
    picker.addEventListener("pointerdown", prime);
    picker.addEventListener("change", () => applyNativePickerToOrderFormTextField(id));
    const textEl = document.getElementById(id);
    if (textEl) textEl.addEventListener("blur", () => syncOrderFormTextFieldToNativePicker(id));
  }
}

/** Маска дд.мм.гггг: только 8 цифр, точки ставятся автоматически; календарь через нативный date. */
export function bindOrderFormDdMmYyyyInputs() {
  const ids = ["order_date", "delivery_date", "installation_date", "reveals_date"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener("input", () => {
      orderFormDdMmYyyyInputHandler(el);
      updateOrderFormDateFieldHighlights(false);
    });
    el.addEventListener("blur", () => updateOrderFormDateFieldHighlights(false));
  }
  bindOrderFormDateCalendarPickers();
}

/** @deprecated используйте bindOrderFormDdMmYyyyInputs */
export function bindOrderFormDateYear20xxInputs() {
  bindOrderFormDdMmYyyyInputs();
}

function parseOrderFormNumber(raw) {
  if (raw == null) return null;
  const s0 = String(raw).trim();
  if (!s0) return null;

  // Убираем пробелы как разделители тысяч
  const s = s0.replace(/[\s\u00A0\u202F]/g, "").replace(",", ".");
  if (s === "" || s === "." || s === "-" || s === "-.") return null;

  // Контроль на слишком много точек (например, "1.2.3")
  const dotCount = (s.match(/\./g) || []).length;
  if (dotCount > 1) return null;

  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

function formatNumberWithSpaces(num, decimals) {
  if (num == null || !Number.isFinite(num)) return "";

  const sign = num < 0 ? "-" : "";
  const abs = Math.abs(num);

  let fixed;
  if (decimals != null) {
    fixed = abs.toFixed(decimals);
  } else {
    fixed = String(abs);
  }

  let intPart = fixed;
  let fracPart = "";
  if (fixed.includes(".")) {
    [intPart, fracPart] = fixed.split(".");
  }

  intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");

  if (decimals != null && decimals > 0) {
    fracPart = (fracPart || "").replace(/0+$/g, "");
    if (fracPart) return `${sign}${intPart}.${fracPart}`;
  }

  return `${sign}${intPart}`;
}

function formatOrderFormNumberValue(value, decimals) {
  const n = typeof value === "number" ? value : parseOrderFormNumber(value);
  return n == null ? "" : formatNumberWithSpaces(n, decimals);
}

export function formatOrderFormNumericInputById(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const decimals = ORDER_FORM_NUMERIC_FIELD_DECIMALS[id];
  if (decimals == null) return;

  if (RUBLE_INTEGER_ORDER_FIELD_IDS.includes(id)) {
    const raw = el.value;
    if (raw == null || String(raw).trim() === "") {
      el.value = "";
      el.classList.remove("sum-input-invalid");
      el.removeAttribute("title");
      el.removeAttribute("aria-invalid");
      return;
    }
    const r = tryParseRublesInteger(raw);
    if (r.invalidFormat) {
      el.classList.add("sum-input-invalid");
      el.title = MSG_SUM_INTEGER_ONLY;
      el.setAttribute("aria-invalid", "true");
      return;
    }
    el.classList.remove("sum-input-invalid");
    el.removeAttribute("title");
    el.removeAttribute("aria-invalid");
    if (r.value == null) {
      el.value = "";
      return;
    }
    el.value = formatNumberWithSpaces(r.value, 0);
    return;
  }

  const raw = el.value;
  if (raw == null || String(raw).trim() === "") {
    el.value = "";
    return;
  }
  const n = parseOrderFormNumber(raw);
  if (n == null) return; /* Не очищаем поле, если введён частично/нечисловое */
  el.value = formatNumberWithSpaces(n, decimals);
}

// ===== Синхронизация верхнего скролла таблицы «Заказы» =====
let ordersScrollSyncAttached = false;
let ordersScrollTopEl = null;
let ordersScrollBottomEl = null;
let ordersScrollInnerEl = null;
let ordersScrollSpacerEl = null;

/** Горизонтальный скролл таблицы — во внутреннем блоке */
function ordersHorizontalScrollEl() {
  return ordersScrollInnerEl || ordersScrollBottomEl;
}

function isOrdersCoarseTouchUi() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(hover: none) and (pointer: coarse)").matches
  );
}

/**
 * Тач: ширина блока = ширине таблицы (не шире карточки), без лишнего scrollWidth справа.
 * Берём table.scrollWidth — inner.scrollWidth на iOS иногда раздувается.
 */
function clampOrdersHorizontalScroll() {
  const el = document.getElementById("ordersTableScrollInner");
  if (!el || !isOrdersCoarseTouchUi()) return;
  const max = el.scrollWidth - el.clientWidth;
  if (max <= 0) return;
  if (el.scrollLeft > max) el.scrollLeft = max;
}

function syncOrdersTableOuterWidthForTouch() {
  const bottom = document.getElementById("ordersTableScrollBottom");
  const inner = document.getElementById("ordersTableScrollInner");
  const table = document.getElementById("ordersTable");
  if (!bottom || !inner) return;
  if (!isOrdersCoarseTouchUi()) {
    bottom.style.removeProperty("width");
    inner.style.removeProperty("width");
    return;
  }
  const apply = () => {
    const parent = bottom.parentElement;
    const avail = parent ? parent.clientWidth : window.innerWidth;
    if (!(avail > 0)) return;
    const tw = table ? table.scrollWidth : inner.scrollWidth;
    if (!(tw > 0)) return;
    const outerW = Math.min(tw, avail);
    bottom.style.width = `${outerW}px`;
    if (tw <= avail) {
      inner.style.width = `${tw}px`;
    } else {
      inner.style.width = "100%";
    }
    clampOrdersHorizontalScroll();
  };
  requestAnimationFrame(() => {
    apply();
    requestAnimationFrame(apply);
  });
}

function ordersCopyScrollBottomToTop() {
  const h = ordersHorizontalScrollEl();
  if (!ordersScrollTopEl || !h) return;
  const next = h.scrollLeft;
  if (ordersScrollTopEl.scrollLeft !== next) ordersScrollTopEl.scrollLeft = next;
}

function ordersCopyScrollTopToBottom() {
  const h = ordersHorizontalScrollEl();
  if (!ordersScrollTopEl || !h) return;
  const next = ordersScrollTopEl.scrollLeft;
  if (h.scrollLeft !== next) h.scrollLeft = next;
}

function ensureOrdersScrollSync() {
  if (ordersScrollSyncAttached) return;

  ordersScrollTopEl = document.getElementById("ordersTableScrollTop");
  ordersScrollBottomEl = document.getElementById("ordersTableScrollBottom");
  ordersScrollInnerEl = document.getElementById("ordersTableScrollInner");
  ordersScrollSpacerEl = document.getElementById("ordersTableScrollSpacer");

  if (!ordersScrollTopEl || !ordersScrollBottomEl || !ordersScrollSpacerEl || !ordersScrollInnerEl) return;

  const touchUi =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(hover: none) and (pointer: coarse)").matches;

  /* Не копируем scrollLeft в соседний блок на каждом кадре (инерция iOS обрывается).
     Синхронизируем только после паузы в событиях scroll — в конце жеста и после докрута. */
  const idleMs = 80;
  let bottomIdleTimer = null;
  const onHorizontalAreaScroll = () => {
    clampOrdersHorizontalScroll();
    if (bottomIdleTimer) clearTimeout(bottomIdleTimer);
    bottomIdleTimer = setTimeout(() => {
      bottomIdleTimer = null;
      ordersCopyScrollBottomToTop();
    }, idleMs);
  };
  ordersScrollInnerEl.addEventListener("scroll", onHorizontalAreaScroll, { passive: true });
  ordersScrollBottomEl.addEventListener("scroll", onHorizontalAreaScroll, { passive: true });

  if (!touchUi) {
    let topIdleTimer = null;
    ordersScrollTopEl.addEventListener(
      "scroll",
      () => {
        if (topIdleTimer) clearTimeout(topIdleTimer);
        topIdleTimer = setTimeout(() => {
          topIdleTimer = null;
          ordersCopyScrollTopToBottom();
        }, idleMs);
      },
      { passive: true }
    );
  }

  window.addEventListener(
    "resize",
    () => {
      updateOrdersScrollSpacerWidth();
      syncOrdersScrollPositions();
      syncOrdersTableOuterWidthForTouch();
    },
    { passive: true }
  );

  if (window.visualViewport) {
    window.visualViewport.addEventListener(
      "resize",
      () => {
        updateOrdersScrollSpacerWidth();
        syncOrdersTableOuterWidthForTouch();
      },
      { passive: true }
    );
  }

  ordersScrollSyncAttached = true;
}

function updateOrdersScrollSpacerWidth() {
  if (!ordersScrollSpacerEl) return;
  const h = ordersHorizontalScrollEl();
  if (!h) return;
  ordersScrollSpacerEl.style.width = `${h.scrollWidth}px`;
}

function syncOrdersScrollPositions() {
  ordersCopyScrollBottomToTop();
}

export function getFilteredOrders() {
  let list = state.allOrders;

  list = list.filter((order) => !isOrderHiddenForCurrentRole(order));

  if (state.statusFilterSelected && state.statusFilterSelected.length > 0) {
    list = list.filter((order) => {
      const norm = normalizeStatus(order.payment_status);
      return state.statusFilterSelected.includes(norm);
    });
  }

  if (state.orderTypeFilterSelected && state.orderTypeFilterSelected.length > 0) {
    list = list.filter((order) => orderMatchesOrderTypeKeys(order, state.orderTypeFilterSelected));
  }

  if (state.paidFilterSelected && state.paidFilterSelected.length > 0) {
    list = list.filter((order) => state.paidFilterSelected.includes(paidFilterCategory(order)));
  }

  const query = clientSearch?.value.trim().toLowerCase() || "";
  if (query) {
    list = list.filter((order) => {
      const phone = (order.phone || "").toLowerCase();
      const name = (order.client || "").toLowerCase();
      const orderType = (order.order_type || "").toLowerCase();
      const address = (order.address || "").toLowerCase();
      const number = (order.order_number || "").toLowerCase();
      const description = (order.description || "").toLowerCase();
      return phone.includes(query)
        || name.includes(query)
        || orderType.includes(query)
        || address.includes(query)
        || number.includes(query)
        || description.includes(query);
    });
  }

  const df = state.orderDateFilterFrom;
  const dt = state.orderDateFilterTo;
  if (df || dt) {
    list = list.filter((order) => orderMatchesOrderDateRange(order, df, dt));
  }

  return sortOrdersWithOfflinePendingFirst(list);
}

/** Календарная дата заказа YYYY-MM-DD в локальной зоне (для сравнения с input type=date). */
function getOrderCalendarYmd(order) {
  const raw = order.order_date;
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [yy, mm, dd] = s.slice(0, 10).split("-").map(Number);
    const d = new Date(yy, mm - 1, dd);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function orderMatchesOrderDateRange(order, fromYmd, toYmd) {
  const ymd = getOrderCalendarYmd(order);
  if (!ymd) return false;
  let from = fromYmd || null;
  let to = toYmd || null;
  if (from && to && from > to) {
    const t = from;
    from = to;
    to = t;
  }
  if (from && ymd < from) return false;
  if (to && ymd > to) return false;
  return true;
}

function rebaselineAllOrdersFromStateAndPendingQueue() {
  const snap = readSnapshot();
  let serverLike = (snap?.orders || []).map((o) => cloneOrderWithoutOfflineMeta({ ...o }));
  if (serverLike.length === 0) {
    serverLike = readEmergencyOrdersBaseForMerge();
  }
  state.allOrders = normalizeOrdersPhones(mergeServerOrdersWithPendingDisplayRows(serverLike));
  persistEmergencyOrdersView(state.allOrders);
  applyFiltersAndRender();
  updateSectionNavRicherStat();
}

export function applyFiltersAndRender() {
  renderOrders(getFilteredOrders());
  syncOrdersFilterHeadingButtonsState();
  // Сигнал UI-коду: фильтры (статусы/типы) изменились и таблица перерисована.
  // Это нужно, чтобы синхронизировать внешние быстрые переключатели.
  document.dispatchEvent(new CustomEvent("orders-filters-updated"));
}

function escapeHtml(s) {
  if (s == null || s === "") return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  if (s == null || s === "") return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function formatDateDDMMYYYY(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return "";
  const s = dateStr.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return dateStr;
  const [, y, m, d] = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  return `${d}.${m}.${y}`;
}

/** Колонка «Монтаж»: при включённом монтаже без даты показываем «есть». */
function formatInstallationDateCell(order) {
  const installationOn =
    order.installation === true ||
    order.installation === 1 ||
    order.installation === "1";
  const raw = order.installation_date;
  const emptyDate = raw == null || String(raw).trim() === "";
  if (installationOn && emptyDate) {
    return '<span class="status-value">есть</span>';
  }
  return formatDateShortRU(order.installation_date);
}

/** Колонка «Откосы»: при включённой галке без даты откосов показываем «есть». */
function formatRevealsDateCell(order) {
  const revealsOn =
    order.reveals === true ||
    order.reveals === 1 ||
    order.reveals === "1";
  const raw = order.reveals_date;
  const emptyDate = raw == null || String(raw).trim() === "";
  if (revealsOn && emptyDate) {
    return '<span class="status-value">есть</span>';
  }
  return formatDateShortRU(order.reveals_date);
}

/** Оплачено = "да", если заполнено "Кому остаток" ИЛИ Остаток = 0. */
export function isOrderPaid(order) {
  const remainingToRaw = (order.remaining_to || "").trim();
  const paidByRemainingTo = remainingToRaw !== "" && remainingToRaw !== "—";

  const remainingAmount = parseOrderFormNumber(order.remaining_amount);
  const paidByRemainingAmountZero = remainingAmount != null && Math.abs(remainingAmount) < 1e-9;

  return paidByRemainingTo || paidByRemainingAmountZero;
}

/** Категория для фильтра «Опл.» (как в ячейке: да / нет / пусто при отсутствии суммы). */
function paidFilterCategory(order) {
  if (order.amount == null || order.amount === "") return "Без суммы";
  return isOrderPaid(order) ? "да" : "нет";
}

function isRemainingAmountZero(order) {
  const remainingAmount = parseOrderFormNumber(order.remaining_amount);
  return remainingAmount != null && Math.abs(remainingAmount) < 1e-9;
}

/** Кнопка «Редактировать» в таблице и в меню по номеру. */
export function canShowEditButtonForOrder(order) {
  if (!canMutateOrders()) return false;
  if (isOrderHiddenForCurrentRole(order)) return false;
  if (isUserLite() && isOrderEditLockedForUserLite(order)) return false;
  return true;
}

export async function setLockEditForUserLite(orderId, locked) {
  if (isUserLite()) return false;
  if (state.ordersFromCache) {
    setMessage("В режиме локальной копии нельзя менять блокировку заявок", "#d32f2f");
    return false;
  }
  const val = locked ? 1 : 0;
  const { error } = await supabaseClient
    .from("orders")
    .update({ lock_edit_for_user_lite: val })
    .eq("id", orderId);

  if (error) {
    console.error(error);
    setMessage("Не удалось сохранить настройку", "#d32f2f");
    return false;
  }

  const o = state.allOrders.find((x) => Number(x.id) === Number(orderId));
  if (o) o.lock_edit_for_user_lite = val;

  setMessage(
    locked ? "Для user_lite редактирование закрыто" : "Для user_lite редактирование открыто",
    ""
  );
  applyClientFilter();
  return true;
}

/** Красный «нет» в колонке «Оплачено» — см. paidBadge */
function isOplahenoPaidNoAlert(order) {
  if (order.amount == null || order.amount === "") return false;
  if (isOrderPaid(order)) return false;
  const status = order.payment_status || "";
  return status === "Производство" || status === "Товар передан заказчику" || status === "Монтаж выполнен";
}

function paidBadge(order) {
  if (order.amount == null || order.amount === "") return "";
  const paid = isOrderPaid(order);
  const status = order.payment_status || "";
  if (paid) return '<span class="status-paid">да</span>';
  if (isOplahenoPaidNoAlert(order)) return '<span class="paid-no-alert">нет</span>';
  return '<span class="status-value">нет</span>';
}

/** Заголовки столбцов экспорта (как в таблице «Заказы», без колонки удаления). */
export const ORDERS_EXCEL_HEADERS = [
  "Номер",
  "Дата",
  "Клиент",
  "Опл.",
  "Адрес",
  "Описание",
  "Статус",
  "Стоимость",
  "Предоплата",
  "Кому",
  "Остаток",
  "Кому",
  "Отправка",
  "Дата",
  "Монтаж",
  "м2",
  "з/п",
  "Оплатил",
  "Откосы",
  "Моск.",
  "Конс.",
  "Телефон",
];

/** Одна строка для Excel: те же значения, что видны в таблице (без HTML). */
export function getOrderRowValuesForExcel(order) {
  const statusDisplayText =
    order.payment_status === "нет"
      ? "Контакт с клиентом"
      : (order.payment_status ?? "Контакт с клиентом");

  let paidText = "";
  if (order.amount != null && order.amount !== "") {
    paidText = isOrderPaid(order) ? "да" : "нет";
  }

  const remainingStr =
    order.remaining_amount != null && order.remaining_amount !== ""
      ? formatAmount(order.remaining_amount)
      : "";

  const installationOn =
    order.installation === true || order.installation === 1 || order.installation === "1";
  const installationDateEmpty =
    order.installation_date == null || String(order.installation_date).trim() === "";
  const installationText =
    installationOn && installationDateEmpty ? "есть" : formatDateShortRU(order.installation_date);

  const revealsOn = order.reveals === true || order.reveals === 1 || order.reveals === "1";
  const revealsDateEmpty =
    order.reveals_date == null || String(order.reveals_date).trim() === "";
  const revealsText =
    revealsOn && revealsDateEmpty ? "есть" : formatDateShortRU(order.reveals_date);

  return [
    order.id != null ? formatOrderIdTypeChip(order.id, order.order_type) : "",
    formatDateShortRU(order.order_date),
    order.client ?? "",
    paidText,
    order.address ?? "",
    order.description ?? "",
    statusDisplayText,
    order.amount != null && order.amount !== "" ? formatAmount(order.amount) : "",
    order.prepayment != null && order.prepayment !== "" ? formatAmount(order.prepayment) : "",
    order.prepayment_to ? String(order.prepayment_to) : "",
    remainingStr,
    order.remaining_to ? String(order.remaining_to) : "",
    order.delivery ? String(order.delivery) : "",
    formatDateShortRU(order.delivery_date),
    installationText,
    order.area_m2 != null && order.area_m2 !== "" ? String(order.area_m2) : "",
    order.installer_payment_amount != null && order.installer_payment_amount !== ""
      ? formatAmount(order.installer_payment_amount)
      : "",
    order.installer_payment_by ? String(order.installer_payment_by) : "",
    revealsText,
    order.mosquito_nets != null && order.mosquito_nets !== "" ? String(order.mosquito_nets) : "",
    order.construction_count != null && order.construction_count !== "" ? String(order.construction_count) : "",
    order.phone ?? "",
  ];
}

/** Индексы как в ORDERS_EXCEL_HEADERS / getOrderRowValuesForExcel: «Опл.», «Остаток». */
const ORDER_ROW_DATE_TOOLTIP_RED_INDEXES = new Set([3, 10]);

/** HTML для всплывающей подсказки по клику на дату заказа: все поля через « | »; Опл. и Остаток — красным. */
export function buildOrderRowFullTooltipHtml(order) {
  const values = getOrderRowValuesForExcel(order);
  return values
    .map((v, i) => {
      const escaped = escapeHtml(String(v ?? ""));
      return ORDER_ROW_DATE_TOOLTIP_RED_INDEXES.has(i)
        ? `<span class="orders-order-date-tooltip-warn">${escaped}</span>`
        : escaped;
    })
    .join(" | ");
}

function sumOrderNumericField(orders, fieldName) {
  let sum = 0;
  for (const order of orders) {
    const n = parseOrderFormNumber(order[fieldName]);
    if (n != null && Number.isFinite(n)) sum += n;
  }
  return sum;
}

function renderOrdersTotals(orders) {
  const row = document.getElementById("ordersTotalsRow");
  if (!row) return;

  const count = orders.length;
  const sumAmount = sumOrderNumericField(orders, "amount");
  const sumPrepayment = sumOrderNumericField(orders, "prepayment");
  const sumRemaining = sumOrderNumericField(orders, "remaining_amount");
  const sumArea = sumOrderNumericField(orders, "area_m2");
  const sumInstaller = sumOrderNumericField(orders, "installer_payment_amount");
  const sumMosquito = sumOrderNumericField(orders, "mosquito_nets");
  const sumConstruction = sumOrderNumericField(orders, "construction_count");

  const fmt = (n) => (count ? formatAmount(n) : "");
  const fmtMoneyInt = (n) => (count ? formatAmountWholeRubles(n) : "");
  const fmtAreaM2 = (n) =>
    count && Number.isFinite(n) ? formatAmount(Number(n.toFixed(2))) : "";

  /** Серая подложка как у «Клиент» в #ordersTable (.status-value). */
  const totalsCellSpan = (raw) => {
    const s = String(raw ?? "").trim();
    if (!s) return "";
    return `<span class="status-value">${escapeHtml(s)}</span>`;
  };

  row.innerHTML = `
    <td class="td-orders-totals-count">${totalsCellSpan(String(count))}</td>
    <td class="td-money">${totalsCellSpan(fmtMoneyInt(sumAmount))}</td>
    <td class="td-money">${totalsCellSpan(fmtMoneyInt(sumPrepayment))}</td>
    <td class="td-money">${totalsCellSpan(fmtMoneyInt(sumRemaining))}</td>
    <td class="td-area-m2">${totalsCellSpan(fmtAreaM2(sumArea))}</td>
    <td class="td-money td-installer-payment">${totalsCellSpan(fmtMoneyInt(sumInstaller))}</td>
    <td>${totalsCellSpan(fmt(sumMosquito))}</td>
    <td>${totalsCellSpan(fmt(sumConstruction))}</td>
  `;
}

function buildOrderMainFieldsCellsHtml(order) {
  const filesCount = state.filesCountMap[order.id] || 0;
  const phone = order.phone ?? "";
  const client = order.client ?? "";
  const address = order.address ?? "";
  const description = order.description ?? "";
  const hasPhone = Boolean((phone || "").trim());
  const orderIdChipClasses = ["status-value", "order-id-chip"];
  if (filesCount > 0) orderIdChipClasses.push("order-id-chip--has-files");
  if (hasPhone) orderIdChipClasses.push("order-id-chip--has-phone");
  if (isOrderEditLockedForUserLite(order)) orderIdChipClasses.push("order-id-chip--lock-user-lite");
  const tasksHighlight =
    order.tasks_highlight === true ||
    order.tasks_highlight === 1 ||
    order.tasks_highlight === "1";
  if (tasksHighlight) orderIdChipClasses.push("order-id-chip--highlight-tasks");
  /* Номер в таблице: 4 цифры + «_» + первая буква типа заказа (например 0112_О) */
  const orderNumberDisplay =
    order.id != null ? escapeHtml(formatOrderIdTypeChip(order.id, order.order_type)) : "";
  return {
    filesCount,
    phone,
    client,
    address,
    description,
    orderIdChipClasses,
    orderNumberDisplay,
  };
}

/** Строка заказа для выпадающего списка на странице «Сообщения» (как в таблице «Заказы»). */
export function buildOrderPickerRowHtml(order) {
  const { client, address, description, orderIdChipClasses, orderNumberDisplay } =
    buildOrderMainFieldsCellsHtml(order);
  return `<div class="messages-suggestion-order-row" role="presentation">
    <span class="messages-suggestion-order-cell td-order-id">
      <span class="${orderIdChipClasses.join(" ")}">${orderNumberDisplay}</span>
    </span>
    <span class="messages-suggestion-order-cell td-order-date">${formatDateShortRU(order.order_date)}</span>
    <span class="messages-suggestion-order-cell td-order-client" data-fulltext="${escapeAttr(client)}">${client ? `<span class="status-value">${escapeHtml(client)}</span>` : ""}</span>
    <span class="messages-suggestion-order-cell td-order-address" data-fulltext="${escapeAttr(address)}">${address ? `<span class="status-value">${escapeHtml(address)}</span>` : ""}</span>
    <span class="messages-suggestion-order-cell td-order-description" data-fulltext="${escapeAttr(description)}">${description ? `<span class="status-value">${escapeHtml(description)}</span>` : ""}</span>
  </div>`;
}

export function renderOrders(orders) {
  document.dispatchEvent(new CustomEvent("orders-table-will-render"));
  const table = document.querySelector("#ordersTable tbody");
  if (!table) return;

  const parts = new Array(orders.length);
  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    const allowDeleteThisRow =
      canDeleteOrders() && (!state.ordersFromCache || isOfflineClientOrderId(Number(order.id)));
    const deleteButton = allowDeleteThisRow
      ? `<button type="button" class="btn-icon btn-delete" onclick="deleteOrder(${order.id})" title="Удалить"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>`
      : "";
    const trClass = order.__offlinePendingSync ? ' class="tr-order-offline-pending"' : "";

    const { filesCount, phone, client, address, description, orderIdChipClasses, orderNumberDisplay } =
      buildOrderMainFieldsCellsHtml(order);
    const statusDisplayText =
      order.payment_status === "нет" ? "Контакт с клиентом" : (order.payment_status ?? "Контакт с клиентом");
    parts[i] = `
      <tr${trClass}>
        <td class="td-order-id" data-order-id="${order.id ?? ""}" data-phone="${escapeAttr(phone)}" data-files-count="${filesCount}" data-lock-edit-user-lite="${isOrderEditLockedForUserLite(order) ? "1" : "0"}">
          <span class="${orderIdChipClasses.join(" ")}">
            ${orderNumberDisplay}
          </span>
        </td>
        <td class="td-order-date">${formatDateShortRU(order.order_date)}</td>
        <td class="td-order-client" data-fulltext="${escapeAttr(client)}">${client ? `<span class="status-value">${escapeHtml(client)}</span>` : ""}</td>
        <td class="td-paid">${paidBadge(order)}</td>
        <td class="td-order-address" data-fulltext="${escapeAttr(address)}">${address ? `<span class="status-value">${escapeHtml(address)}</span>` : ""}</td>
        <td class="td-order-description" data-fulltext="${escapeAttr(description)}">${description ? `<span class="status-value">${escapeHtml(description)}</span>` : ""}</td>
        <td class="td-order-status" data-fulltext="${escapeAttr(statusDisplayText)}"><span class="status-value">${escapeHtml(statusDisplayText)}</span></td>
        <td class="td-money td-main-amount">${order.amount != null && order.amount !== "" ? `<span class="status-value">${formatAmount(order.amount)}</span>` : ""}</td>
        <td class="td-prepayment td-money">${order.prepayment != null && order.prepayment !== "" ? `<span class="status-value">${formatAmount(order.prepayment)}</span>` : ""}</td>
        <td class="td-prepayment-to">${order.prepayment_to ? escapeHtml(order.prepayment_to) : ""}</td>
        <td class="td-remaining td-money">${
          order.remaining_amount != null && order.remaining_amount !== ""
            ? order.remaining_to || isRemainingAmountZero(order)
              ? `<span class="installer-paid-value">${formatAmount(order.remaining_amount)}</span>`
              : isOplahenoPaidNoAlert(order)
                ? `<span class="paid-no-alert">${formatAmount(order.remaining_amount)}</span>`
                : `<span class="status-value">${formatAmount(order.remaining_amount)}</span>`
            : ""
        }</td>
        <td class="td-remaining-to">${order.remaining_to ? escapeHtml(order.remaining_to) : ""}</td>
        <td class="td-delivery">${order.delivery ? escapeHtml(order.delivery) : ""}</td>
        <td class="td-delivery-date">${formatDateShortRU(order.delivery_date)}</td>
        <td class="td-installation-date">${formatInstallationDateCell(order)}</td>
        <td class="td-area-m2">${order.area_m2 != null && order.area_m2 !== "" ? escapeHtml(String(order.area_m2)) : ""}</td>
        <td class="td-money td-installer-payment">${
          order.installer_payment_amount != null && order.installer_payment_amount !== ""
            ? order.installer_payment_by
              ? `<span class="installer-paid-value">${formatAmount(order.installer_payment_amount)}</span>`
              : `<span class="status-value">${formatAmount(order.installer_payment_amount)}</span>`
            : ""
        }</td>
        <td>${order.installer_payment_by ? escapeHtml(order.installer_payment_by) : ""}</td>
        <td>${formatRevealsDateCell(order)}</td>
        <td class="td-mosquito-nets">${order.mosquito_nets != null && order.mosquito_nets !== "" ? escapeHtml(String(order.mosquito_nets)) : ""}</td>
        <td class="td-construction-count">${order.construction_count != null && order.construction_count !== "" ? escapeHtml(String(order.construction_count)) : ""}</td>
        <td class="td-phone">${phone ? escapeHtml(phone) : ""}</td>
        <td class="td-actions td-delete">${deleteButton}</td>
      </tr>
    `;
  }

  table.innerHTML = parts.join("");

  // Подсказки по обрезке текста и sync скролла — после первой отрисовки, чтобы не блокировать paint.
  requestAnimationFrame(() => {
    table.querySelectorAll(".td-order-client, .td-order-address, .td-order-description, .td-order-status").forEach((cell) => {
      const full = cell.getAttribute("data-fulltext");
      if (!full) return;
      const chip = cell.querySelector(".status-value");
      const truncated =
        chip && chip.scrollWidth > chip.clientWidth + 0.5
          ? true
          : cell.scrollWidth > cell.clientWidth + 0.5;
      if (truncated) cell.setAttribute("title", full);
      else cell.removeAttribute("title");
    });

    ensureOrdersScrollSync();
    updateOrdersScrollSpacerWidth();
    syncOrdersScrollPositions();
    applyOrdersTableMobileFit();
    syncOrdersTableOuterWidthForTouch();
  });

  renderOrdersTotals(orders);
}

export function applyClientFilter() {
  applyFiltersAndRender();
}

function renderStatusFilterDropdown() {
  const container = document.getElementById("statusFilterCheckboxes");
  if (!container) return;
  const allSelected = !state.statusFilterSelected || state.statusFilterSelected.length === 0;
  const allHtml = `<label class="status-filter-item status-filter-all"><input type="checkbox" data-all="true" ${allSelected ? "checked" : ""}> Все</label>`;
  const optionsHtml = STATUS_OPTIONS.map((value) => {
    const checked = allSelected || state.statusFilterSelected.includes(value);
    return `<label class="status-filter-item"><input type="checkbox" data-status="${escapeAttr(value)}" ${checked ? "checked" : ""}> ${escapeHtml(value)}</label>`;
  }).join("");
  container.innerHTML = allHtml + optionsHtml;
  container.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", onStatusFilterChange);
  });
}

function onStatusFilterChange(e) {
  const container = document.getElementById("statusFilterCheckboxes");
  if (!container) return;
  const target = e.target;
  const allCb = container.querySelector('input[data-all="true"]');
  const statusCbs = container.querySelectorAll('input[type=checkbox][data-status]');

  if (target === allCb) {
    const checked = allCb.checked;
    statusCbs.forEach((cb) => { cb.checked = checked; });
    state.statusFilterSelected = checked ? [] : [];
    applyFiltersAndRender();
    return;
  }

  const checkedValues = Array.from(statusCbs).filter((cb) => cb.checked).map((el) => el.dataset.status);
  state.statusFilterSelected = checkedValues.length === STATUS_OPTIONS.length ? [] : checkedValues;
  if (allCb) allCb.checked = checkedValues.length === STATUS_OPTIONS.length;
  applyFiltersAndRender();
}

function closeStatusFilterDropdown() {
  const btn = document.getElementById("statusFilterBtn");
  const dropdown = document.getElementById("statusFilterDropdown");
  if (dropdown) dropdown.style.display = "none";
  if (btn) btn.setAttribute("aria-expanded", "false");
}

function closeOrderTypeFilterDropdown() {
  const btn = document.getElementById("orderTypeFilterBtn");
  const dropdown = document.getElementById("orderTypeFilterDropdown");
  if (dropdown) dropdown.style.display = "none";
  if (btn) btn.setAttribute("aria-expanded", "false");
}

function closePaidFilterDropdown() {
  const btn = document.getElementById("paidFilterBtn");
  const dropdown = document.getElementById("paidFilterDropdown");
  if (dropdown) dropdown.style.display = "none";
  if (btn) btn.setAttribute("aria-expanded", "false");
}

function closeOrderDateFilterDropdown() {
  const btn = document.getElementById("orderDateFilterBtn");
  const dropdown = document.getElementById("orderDateFilterDropdown");
  if (dropdown) dropdown.style.display = "none";
  if (btn) btn.setAttribute("aria-expanded", "false");
}

function syncOrderDateFilterInputsFromState() {
  const fromEl = document.getElementById("orderDateFilterFromInput");
  const toEl = document.getElementById("orderDateFilterToInput");
  if (fromEl) fromEl.value = state.orderDateFilterFrom || "";
  if (toEl) toEl.value = state.orderDateFilterTo || "";
}

function syncOrdersFilterHeadingButtonsState() {
  const dateBtn = document.getElementById("orderDateFilterBtn");
  if (dateBtn) {
    dateBtn.classList.toggle(
      "orders-filter-heading-btn--active",
      Boolean(state.orderDateFilterFrom || state.orderDateFilterTo)
    );
  }
  const typeBtn = document.getElementById("orderTypeFilterBtn");
  if (typeBtn) {
    typeBtn.classList.toggle(
      "orders-filter-heading-btn--active",
      (state.orderTypeFilterSelected?.length || 0) > 0
    );
  }
  const paidBtn = document.getElementById("paidFilterBtn");
  if (paidBtn) {
    paidBtn.classList.toggle("orders-filter-heading-btn--active", (state.paidFilterSelected?.length || 0) > 0);
  }
  const statusBtn = document.getElementById("statusFilterBtn");
  if (statusBtn) {
    statusBtn.classList.toggle("orders-filter-heading-btn--active", (state.statusFilterSelected?.length || 0) > 0);
  }
}

function renderPaidFilterDropdown() {
  const container = document.getElementById("paidFilterCheckboxes");
  if (!container) return;
  const allSelected = !state.paidFilterSelected || state.paidFilterSelected.length === 0;
  const allHtml = `<label class="status-filter-item status-filter-all"><input type="checkbox" data-paid-all="true" ${allSelected ? "checked" : ""}> Все</label>`;
  const optionsHtml = PAID_FILTER_OPTIONS.map((value) => {
    const checked = allSelected || state.paidFilterSelected.includes(value);
    return `<label class="status-filter-item"><input type="checkbox" data-paid="${escapeAttr(value)}" ${checked ? "checked" : ""}> ${escapeHtml(value)}</label>`;
  }).join("");
  container.innerHTML = allHtml + optionsHtml;
  container.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", onPaidFilterChange);
  });
}

function onPaidFilterChange(e) {
  const container = document.getElementById("paidFilterCheckboxes");
  if (!container) return;
  const target = e.target;
  const allCb = container.querySelector('input[data-paid-all="true"]');
  const paidCbs = container.querySelectorAll("input[type=checkbox][data-paid]");

  if (target === allCb) {
    const checked = allCb.checked;
    paidCbs.forEach((cb) => {
      cb.checked = checked;
    });
    state.paidFilterSelected = checked ? [] : [];
    applyFiltersAndRender();
    return;
  }

  const checkedValues = Array.from(paidCbs).filter((cb) => cb.checked).map((el) => el.dataset.paid);
  state.paidFilterSelected = checkedValues.length === PAID_FILTER_OPTIONS.length ? [] : checkedValues;
  if (allCb) allCb.checked = checkedValues.length === PAID_FILTER_OPTIONS.length;
  applyFiltersAndRender();
}

let tableFilterDocClickBound = false;

function bindTableFilterDocClose() {
  if (tableFilterDocClickBound) return;
  tableFilterDocClickBound = true;
  document.addEventListener("click", () => {
    closeStatusFilterDropdown();
    closeOrderTypeFilterDropdown();
    closePaidFilterDropdown();
    closeOrderDateFilterDropdown();
  });
}

function renderOrderTypeFilterDropdown() {
  const container = document.getElementById("orderTypeFilterCheckboxes");
  if (!container) return;
  const allSelected = !state.orderTypeFilterSelected || state.orderTypeFilterSelected.length === 0;
  const keys = orderTypeFilterKeysForUi();
  const allHtml = `<label class="status-filter-item status-filter-all"><input type="checkbox" data-order-type-all="true" ${allSelected ? "checked" : ""}> Все</label>`;
  const optionsHtml = keys.map((key) => {
    const checked = allSelected || state.orderTypeFilterSelected.includes(key);
    return `<label class="status-filter-item"><input type="checkbox" data-order-type="${escapeAttr(key)}" ${checked ? "checked" : ""}> ${escapeHtml(orderTypeFilterLabel(key))}</label>`;
  }).join("");
  container.innerHTML = allHtml + optionsHtml;
  container.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", onOrderTypeFilterChange);
  });
}

function onOrderTypeFilterChange(e) {
  const container = document.getElementById("orderTypeFilterCheckboxes");
  if (!container) return;
  const target = e.target;
  const allCb = container.querySelector('input[data-order-type-all="true"]');
  const typeCbs = container.querySelectorAll("input[type=checkbox][data-order-type]");

  if (target === allCb) {
    const checked = allCb.checked;
    typeCbs.forEach((cb) => {
      cb.checked = checked;
    });
    state.orderTypeFilterSelected = checked ? [] : [];
    applyFiltersAndRender();
    return;
  }

  const keys = orderTypeFilterKeysForUi();
  const checkedValues = Array.from(typeCbs)
    .filter((cb) => cb.checked)
    .map((el) => el.getAttribute("data-order-type"));
  state.orderTypeFilterSelected =
    checkedValues.length === keys.length ? [] : checkedValues;
  if (allCb) allCb.checked = checkedValues.length === keys.length;
  applyFiltersAndRender();
}

/** Координаты для fixed-выпадашки: при прокрутке настоящая кнопка в thead вне экрана — якорь по клону в закреплённой шапке. */
function getFilterDropdownAnchorRect(originalBtn, cloneButtonSelector) {
  const br = originalBtn.getBoundingClientRect();
  const roughlyVisible =
    br.width > 0 && br.height > 0 && br.bottom > 4 && br.top < window.innerHeight - 4;
  if (roughlyVisible) return br;

  const wrap = document.getElementById("ordersTableStickyHeadWrap");
  if (wrap?.hidden) return br;

  const cloneBtn = document.querySelector(cloneButtonSelector);
  if (!cloneBtn) return br;
  const cr = cloneBtn.getBoundingClientRect();
  if (cr.width > 0 && cr.height > 0) return cr;
  return br;
}

export function initOrderDateFilter() {
  const btn = document.getElementById("orderDateFilterBtn");
  const dropdown = document.getElementById("orderDateFilterDropdown");
  const applyBtn = document.getElementById("orderDateFilterApplyBtn");
  const resetBtn = document.getElementById("orderDateFilterResetBtn");
  if (!btn || !dropdown) return;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = dropdown.style.display === "block";
    if (isOpen) {
      closeOrderDateFilterDropdown();
    } else {
      closeStatusFilterDropdown();
      closeOrderTypeFilterDropdown();
      closePaidFilterDropdown();
      syncOrderDateFilterInputsFromState();
      const rect = getFilterDropdownAnchorRect(
        btn,
        "#ordersTableStickyHeadTable thead th.th-order-date-header .orders-filter-heading-btn"
      );
      dropdown.style.position = "fixed";
      dropdown.style.zIndex = "1200";
      dropdown.style.top = rect.bottom + 4 + "px";
      dropdown.style.left = rect.left + "px";
      dropdown.style.display = "block";
      btn.setAttribute("aria-expanded", "true");
    }
  });

  bindTableFilterDocClose();

  dropdown.addEventListener("click", (e) => e.stopPropagation());

  if (applyBtn) {
    applyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const fromEl = document.getElementById("orderDateFilterFromInput");
      const toEl = document.getElementById("orderDateFilterToInput");
      const fromVal = (fromEl?.value || "").trim() || null;
      const toVal = (toEl?.value || "").trim() || null;
      state.orderDateFilterFrom = fromVal;
      state.orderDateFilterTo = toVal;
      closeOrderDateFilterDropdown();
      applyFiltersAndRender();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      state.orderDateFilterFrom = null;
      state.orderDateFilterTo = null;
      syncOrderDateFilterInputsFromState();
      closeOrderDateFilterDropdown();
      applyFiltersAndRender();
    });
  }

  syncOrdersFilterHeadingButtonsState();
}

export function initStatusFilter() {
  const btn = document.getElementById("statusFilterBtn");
  const dropdown = document.getElementById("statusFilterDropdown");
  if (!btn || !dropdown) return;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = dropdown.style.display === "block";
    if (isOpen) {
      closeStatusFilterDropdown();
    } else {
      closeOrderTypeFilterDropdown();
      closePaidFilterDropdown();
      closeOrderDateFilterDropdown();
      renderStatusFilterDropdown();
      const rect = getFilterDropdownAnchorRect(
        btn,
        "#ordersTableStickyHeadTable thead th.th-status-header .orders-filter-heading-btn"
      );
      dropdown.style.position = "fixed";
      dropdown.style.zIndex = "1200";
      dropdown.style.top = rect.bottom + 4 + "px";
      dropdown.style.left = rect.left + "px";
      dropdown.style.display = "block";
      btn.setAttribute("aria-expanded", "true");
    }
  });

  bindTableFilterDocClose();

  dropdown.addEventListener("click", (e) => e.stopPropagation());
}

export function initOrderTypeFilter() {
  const btn = document.getElementById("orderTypeFilterBtn");
  const dropdown = document.getElementById("orderTypeFilterDropdown");
  if (!btn || !dropdown) return;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = dropdown.style.display === "block";
    if (isOpen) {
      closeOrderTypeFilterDropdown();
    } else {
      closeStatusFilterDropdown();
      closePaidFilterDropdown();
      closeOrderDateFilterDropdown();
      renderOrderTypeFilterDropdown();
      const rect = getFilterDropdownAnchorRect(
        btn,
        "#ordersTableStickyHeadTable thead button.order-type-filter-btn"
      );
      dropdown.style.position = "fixed";
      dropdown.style.zIndex = "1200";
      dropdown.style.top = rect.bottom + 4 + "px";
      dropdown.style.left = rect.left + "px";
      dropdown.style.display = "block";
      btn.setAttribute("aria-expanded", "true");
    }
  });

  bindTableFilterDocClose();

  dropdown.addEventListener("click", (e) => e.stopPropagation());
}

export function initPaidFilter() {
  const btn = document.getElementById("paidFilterBtn");
  const dropdown = document.getElementById("paidFilterDropdown");
  if (!btn || !dropdown) return;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = dropdown.style.display === "block";
    if (isOpen) {
      closePaidFilterDropdown();
    } else {
      closeStatusFilterDropdown();
      closeOrderTypeFilterDropdown();
      closeOrderDateFilterDropdown();
      renderPaidFilterDropdown();
      const rect = getFilterDropdownAnchorRect(
        btn,
        "#ordersTableStickyHeadTable thead button.paid-filter-btn"
      );
      dropdown.style.position = "fixed";
      dropdown.style.zIndex = "1200";
      dropdown.style.top = rect.bottom + 4 + "px";
      dropdown.style.left = rect.left + "px";
      dropdown.style.display = "block";
      btn.setAttribute("aria-expanded", "true");
    }
  });

  bindTableFilterDocClose();

  dropdown.addEventListener("click", (e) => e.stopPropagation());
}

function parseRublesFieldFromDom(id) {
  const r = tryParseRublesInteger(document.getElementById(id)?.value);
  if (r.invalidFormat) return null;
  return r.value;
}

/** Порядок и подписи полей для комментария в order_history */
const ORDER_HISTORY_FIELDS = [
  { key: "order_type", label: "Тип заказа" },
  { key: "order_number", label: "Номер заказа" },
  { key: "order_date", label: "Дата и время заказа" },
  { key: "phone", label: "Телефон" },
  { key: "client", label: "Клиент" },
  { key: "address", label: "Адрес" },
  { key: "payment_status", label: "Статус" },
  { key: "description", label: "Комментарий" },
  { key: "amount", label: "Стоимость" },
  { key: "prepayment", label: "Предоплата" },
  { key: "prepayment_to", label: "Кому предоплата" },
  { key: "remaining_amount", label: "Остаток" },
  { key: "remaining_to", label: "Кому остаток" },
  { key: "area_m2", label: "Площадь м²" },
  { key: "mosquito_nets", label: "Москитные сетки" },
  { key: "construction_count", label: "Конструкций" },
  { key: "delivery", label: "Доставка" },
  { key: "delivery_date", label: "Дата доставки" },
  { key: "installation", label: "Монтаж" },
  { key: "installation_date", label: "Дата монтажа" },
  { key: "installer_name", label: "Монтажник" },
  { key: "reveals", label: "Откосы" },
  { key: "reveals_date", label: "Дата откосов" },
  { key: "installer_payment_amount", label: "з/п монтаж" },
  { key: "installer_payment_by", label: "Кто оплатил монтаж" },
];

function formatOrderHistoryDateTimeForDisplay(iso) {
  if (iso == null || iso === "") return "—";
  const s = String(iso).trim();
  const datePart = s.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return s || "—";
  const ddmmyyyy = formatDateDDMMYYYY(datePart);
  const tm = s.match(/T(\d{2}):(\d{2})/);
  if (!tm) return ddmmyyyy;
  return `${ddmmyyyy} ${tm[1]}:${tm[2]}`;
}

function formatOrderHistoryValue(key, val) {
  if (val === true) return "да";
  if (val === false) return "нет";
  if (key === "order_date") return formatOrderHistoryDateTimeForDisplay(val);
  if (key === "delivery_date" || key === "installation_date" || key === "reveals_date") {
    if (val == null || val === "") return "—";
    const s = String(val).trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? formatDateDDMMYYYY(s) : String(val);
  }
  const rubleKeys = new Set(["amount", "prepayment", "remaining_amount", "installer_payment_amount"]);
  if (rubleKeys.has(key)) {
    if (val == null || val === "") return "—";
    const n = typeof val === "number" ? val : Number(val);
    return Number.isFinite(n) ? formatAmount(n) : "—";
  }
  const numKeys = {
    area_m2: ORDER_FORM_NUMERIC_FIELD_DECIMALS.area_m2,
    mosquito_nets: ORDER_FORM_NUMERIC_FIELD_DECIMALS.mosquito_nets,
    construction_count: ORDER_FORM_NUMERIC_FIELD_DECIMALS.construction_count,
  };
  if (Object.prototype.hasOwnProperty.call(numKeys, key)) {
    if (val == null || val === "") return "—";
    const n = typeof val === "number" ? val : parseOrderFormNumber(val);
    return n == null ? "—" : formatOrderFormNumberValue(n, numKeys[key]);
  }
  if (val == null || val === "") return "—";
  return String(val);
}

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
  if (key === "installation" || key === "reveals") {
    return !!a === !!b;
  }
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

function shouldIncludeFieldOnCreate(key, val) {
  if (key === "installation" || key === "reveals") return val === true;
  if (typeof val === "boolean") return val === true;
  if (typeof val === "number") return val != null && Number.isFinite(val);
  if (val == null) return false;
  if (typeof val === "string") return String(val).trim() !== "";
  return false;
}

/**
 * Текст комментария для order_history: «Поле: старое -> новое; …».
 * @param {Record<string, unknown> | null} prev снимок до правок (null при создании)
 * @param {Record<string, unknown>} next данные сохранения (getFormData)
 * @param {boolean} wasEditing режим редактирования
 */
function buildOrderHistoryComment(prev, next, wasEditing) {
  if (!wasEditing) {
    const fieldParts = [];
    for (const { key, label } of ORDER_HISTORY_FIELDS) {
      const nv = next[key];
      if (!shouldIncludeFieldOnCreate(key, nv)) continue;
      fieldParts.push(`${label}: — -> ${formatOrderHistoryValue(key, nv)}`);
    }
    return fieldParts.length > 0 ? `Заказ создан; ${fieldParts.join("; ")}` : "Заказ создан";
  }

  const parts = [];
  for (const { key, label } of ORDER_HISTORY_FIELDS) {
    const ov = prev ? prev[key] : undefined;
    const nv = next[key];
    if (valuesEqualForOrderHistory(key, ov, nv)) continue;
    parts.push(`${label}: ${formatOrderHistoryValue(key, ov)} -> ${formatOrderHistoryValue(key, nv)}`);
  }
  return parts.length > 0 ? parts.join("; ") : "Сохранено без изменений";
}

export function getFormData() {
  const orderNumberEl = document.getElementById("order_number");
  return {
    phone: normalizeOrderPhone(document.getElementById("phone").value),
    client: document.getElementById("client").value.trim() || null,
    order_type: document.getElementById("order_type")?.value.trim() || null,
    address: document.getElementById("address").value.trim() || null,
    payment_status: document.getElementById("payment_status").value.trim() || null,
    order_date: syncOrderFormDateTimeFromDom(),
    order_number: orderNumberEl ? (orderNumberEl.value.trim() || null) : null,
    description: document.getElementById("description").value.trim() || null,
    amount: parseRublesFieldFromDom("amount"),
    prepayment: parseRublesFieldFromDom("prepayment"),
    prepayment_to: document.getElementById("prepayment_to").value.trim() || null,
    remaining_amount: parseRublesFieldFromDom("remaining_amount"),
    remaining_to: document.getElementById("remaining_to").value.trim() || null,
    area_m2: parseOrderFormNumber(document.getElementById("area_m2").value),
    mosquito_nets: parseOrderFormNumber(document.getElementById("mosquito_nets").value),
    construction_count: parseOrderFormNumber(document.getElementById("construction_count").value),
    delivery: document.getElementById("delivery").value.trim() || null,
    delivery_date: syncOrderFormDateFieldFromDom("delivery_date", "date"),
    installation: document.getElementById("installation").checked,
    installation_date: document.getElementById("installation").checked
      ? syncOrderFormDateFieldFromDom("installation_date", "date")
      : null,
    reveals: document.getElementById("reveals").checked,
    reveals_date: document.getElementById("reveals").checked
      ? syncOrderFormDateFieldFromDom("reveals_date", "date")
      : null,
    installer_name: document.getElementById("installer_name")?.value?.trim() || null,
    installer_payment_amount: parseRublesFieldFromDom("installer_payment_amount"),
    installer_payment_by: document.getElementById("installer_payment_by")?.value?.trim() || null,
  };
}

/** Автозаполнение Остаток = Стоимость - Предоплата, если Стоимость заполнена */
export function updateRemainingFromCostAndPrepayment() {
  const amountEl = document.getElementById("amount");
  const prepaymentEl = document.getElementById("prepayment");
  const remainingEl = document.getElementById("remaining_amount");
  if (!amountEl || !prepaymentEl || !remainingEl) return;
  const amountR = tryParseRublesInteger(amountEl.value);
  const prepayR = tryParseRublesInteger(prepaymentEl.value);
  if (amountR.invalidFormat || prepayR.invalidFormat) return;
  const amount = amountR.value;
  if (amount == null) return;
  const prepayment = prepayR.value ?? 0;
  const remaining = amount - prepayment;
  remainingEl.value = formatOrderFormNumberValue(remaining, ORDER_FORM_NUMERIC_FIELD_DECIMALS.remaining_amount);
}

/** Оплачено = "да", если заполнено "Кому остаток" (select) ИЛИ Остаток = 0. */
export function updatePaidField() {
  const remainingToEl = document.getElementById("remaining_to");
  const paidEl = document.getElementById("paid");
  const remainingAmountEl = document.getElementById("remaining_amount");
  if (!paidEl || !remainingToEl || remainingToEl.tagName !== "SELECT") return;

  const remainingToRaw = (remainingToEl.value || "").trim();
  const remainingToFilled = remainingToRaw !== "" && remainingToRaw !== "—";

  const remainingR = remainingAmountEl ? tryParseRublesInteger(remainingAmountEl.value) : { value: null, invalidFormat: false };
  if (remainingR.invalidFormat) return;
  const remainingAmount = remainingR.value;
  const remainingAmountZero = remainingAmount != null && remainingAmount === 0;

  paidEl.value = remainingToFilled || remainingAmountZero ? "да" : "нет";
}

export function updateConditionalRequiredHighlight() {
  const prepaymentVal = (document.getElementById("prepayment")?.value || "").trim();
  const prepaymentToVal = (document.getElementById("prepayment_to")?.value || "").trim();
  const deliveryVal = (document.getElementById("delivery")?.value || "").trim();
  const deliveryDateVal = (document.getElementById("delivery_date")?.value || "").trim();
  const deliveryDateComplete = !!parseOrderFormDdMmYyyyToIso(deliveryDateVal);
  const prepaymentToEl = document.getElementById("prepayment_to");
  const deliveryDateEl = document.getElementById("delivery_date");
  if (prepaymentToEl) prepaymentToEl.classList.toggle("conditional-invalid", !!prepaymentVal && !prepaymentToVal);
  if (deliveryDateEl) deliveryDateEl.classList.toggle("conditional-invalid", !!deliveryVal && !deliveryDateComplete);
}

function getInstallerPaymentElements() {
  return {
    block: document.getElementById("installer_payment_block"),
    amountEl: document.getElementById("installer_payment_amount"),
    byEl: document.getElementById("installer_payment_by"),
    nameEl: document.getElementById("installer_name"),
    rateEl: document.getElementById("installer_rate_per_m2"),
    calcBtn: document.getElementById("installer_calc_btn"),
  };
}

/**
 * Заполнить select «Монтажник» списком из настроек (Монтажники).
 * @param {string} [selectedValue] — текущее значение заказа (сохраняется, даже если уже нет в списке)
 */
export function populateOrderFormInstallerSelect(selectedValue) {
  const sel = document.getElementById("installer_name");
  if (!sel) return;
  const current =
    selectedValue != null
      ? String(selectedValue).trim()
      : String(sel.value || "").trim();
  const names = getEditors();
  const opts = ['<option value="">—</option>'];
  const seen = new Set();
  for (const name of names) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    opts.push(`<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`);
  }
  if (current && !seen.has(current)) {
    opts.push(`<option value="${escapeAttr(current)}">${escapeHtml(current)}</option>`);
  }
  sel.innerHTML = opts.join("");
  sel.value = current;
  if (sel.value !== current) sel.value = "";
}

function applyOrderFormFieldsVisibilityForRole() {
  const hideForShop = isUserShop();
  const rows = new Set();
  [
    document.getElementById("orderFormAreaRow"),
    document.getElementById("orderFormInstallationRow"),
    document.getElementById("installer_payment_block"),
    document.getElementById("orderFormRevealsRow"),
    document.getElementById("area_m2")?.closest(".compact-fields-row"),
    document.getElementById("installation")?.closest(".installation-row"),
    document.getElementById("installer_rate_per_m2")?.closest(".compact-fields-row"),
    document.getElementById("reveals")?.closest(".installation-row"),
  ].forEach((el) => {
    if (el) rows.add(el);
  });
  rows.forEach((el) => {
    el.style.display = hideForShop ? "none" : "";
  });
}

/** Селекты «Кому предоплата» / «Кому остаток». */
const MONEY_RECIPIENT_SELECT_IDS = ["prepayment_to", "remaining_to"];
/** Полный HTML опций до ограничений по роли. */
const moneyRecipientSelectHtmlBackup = new Map();

/**
 * «Безнал» и «Касса» только для admin/user.
 * Для остальных опции убираются из списка; текущее значение при редактировании сохраняется,
 * чтобы не затереть уже записанное при сохранении без изменений.
 */
export function applyMoneyRecipientSelectsForRole() {
  const allowed = canSelectKassaBeznal();
  for (const id of MONEY_RECIPIENT_SELECT_IDS) {
    const sel = document.getElementById(id);
    if (!sel) continue;
    if (!moneyRecipientSelectHtmlBackup.has(id)) {
      moneyRecipientSelectHtmlBackup.set(id, sel.innerHTML);
    }
    const current = String(sel.value || "");
    sel.innerHTML = moneyRecipientSelectHtmlBackup.get(id);
    if (!allowed) {
      for (const opt of [...sel.options]) {
        if (!KASSA_BEZNAL_PLACES.has(opt.value)) continue;
        if (opt.value !== current) opt.remove();
      }
    }
    if (current) {
      sel.value = current;
      if (sel.value !== current) sel.value = "";
    }
  }
}

function bindMoneyRecipientSelectRoleGuards() {
  for (const id of MONEY_RECIPIENT_SELECT_IDS) {
    const sel = document.getElementById(id);
    if (!sel || sel.dataset.moneyRoleBound) continue;
    sel.dataset.moneyRoleBound = "1";
    sel.addEventListener("change", () => applyMoneyRecipientSelectsForRole());
  }
}

/** Новое значение «Касса»/«Безнал» запрещено для роли; прежнее при редактировании — можно оставить. */
function isForbiddenKassaBeznalSelection(newVal, previousVal) {
  if (canSelectKassaBeznal()) return false;
  const next = String(newVal || "").trim();
  if (!KASSA_BEZNAL_PLACES.has(next)) return false;
  return next !== String(previousVal || "").trim();
}

export function setInstallerPaymentBlockDisabled(disabled) {
  const { amountEl, byEl } = getInstallerPaymentElements();
  if (amountEl) amountEl.disabled = disabled;
  if (byEl) byEl.disabled = disabled;
}

const INSTALLER_BLOCK_INACTIVE_CLASS = "installer-block-inactive";

/** Блок оплаты монтажа неактивен (серый, disabled), пока не заполнена дата монтажа. */
export function updateInstallerBlockByInstallationDate() {
  const installationDateInput = document.getElementById("installation_date");
  const raw = (installationDateInput?.value || "").trim();
  const hasDate = !!parseOrderFormDdMmYyyyToIso(raw);
  const { block, amountEl, byEl, nameEl, rateEl, calcBtn } = getInstallerPaymentElements();
  if (!block) return;
  block.classList.toggle(INSTALLER_BLOCK_INACTIVE_CLASS, !hasDate);
  if (rateEl) rateEl.disabled = !hasDate;
  if (nameEl) nameEl.disabled = !hasDate;
  /* Калькулятор всегда кликабелен (кроме блокировки после оплаты), иначе нельзя посчитать Площадь×1м² без даты */
  if (calcBtn) calcBtn.disabled = !!state.installerPaymentDone;
  const amountDisabled = !hasDate || state.installerPaymentDone;
  if (amountEl) amountEl.disabled = amountDisabled;
  const hasAmount = !!(amountEl && String(amountEl.value || "").trim());
  const byDisabled = !hasDate || state.installerPaymentDone || !hasAmount;
  if (byEl) byEl.disabled = byDisabled;
}

/**
 * з/п монтаж = Площадь м² × «Монтаж 1м²».
 * Вызывается с кнопки-калькулятора, при blur площади/ставки и т.д.
 * Значение записывается даже если поле суммы временно disabled (нет даты монтажа).
 */
export function updateInstallerPaymentAmountFromArea() {
  const { amountEl } = getInstallerPaymentElements();
  if (!amountEl || state.installerPaymentDone) return;

  const areaEl = document.getElementById("area_m2");
  const rateEl = document.getElementById("installer_rate_per_m2");
  const area = parseOrderFormNumber(areaEl?.value);
  const rateR = tryParseRublesInteger(rateEl?.value);
  if (rateR.invalidFormat) return;
  const rate = rateR.value;

  if (area != null && rate != null && area > 0 && rate > 0) {
    amountEl.value = formatOrderFormNumberValue(
      Math.round(area * rate),
      ORDER_FORM_NUMERIC_FIELD_DECIMALS.installer_payment_amount
    );
  } else {
    amountEl.value = "";
  }

  updateInstallerBlockByInstallationDate();
}

/** При открытии заказа проверить, есть ли уже запись об оплате монтажнику; если да — заполнить и отключить блок. */
export async function checkInstallerPaymentDone(orderId) {
  if (orderId == null) return;
  if (isOfflineClientOrderId(orderId)) return;
  if (isOfflineDataMode()) return;
  const { data } = await supabaseClient
    .from("calculations")
    .select("from_place, amount")
    .is("deleted_at", null)
    .ilike("comment", `%монтажнику за заказ -${orderId}-%`)
    .limit(1);
  const row = data?.[0];
  if (!row) return;
  state.installerPaymentDone = true;
  const { amountEl, byEl } = getInstallerPaymentElements();
  if (amountEl) amountEl.value = row.amount != null
    ? formatOrderFormNumberValue(row.amount, ORDER_FORM_NUMERIC_FIELD_DECIMALS.installer_payment_amount)
    : "";
  if (byEl) byEl.value = row.from_place || "";
  updateInstallerBlockByInstallationDate();
}

export async function fillForm(order) {
  state.installerPaymentDone = false;
  state.initialOrderSums = {
    amount: order.amount != null ? Number(order.amount) : null,
    prepayment: order.prepayment != null ? Number(order.prepayment) : null,
    remaining_amount: order.remaining_amount != null ? Number(order.remaining_amount) : null,
    installer_payment_amount: order.installer_payment_amount != null ? Number(order.installer_payment_amount) : null,
  };
  state.initialOrderParticipants = {
    prepayment_to: order.prepayment_to || "",
    remaining_to: order.remaining_to || "",
    installer_payment_by: order.installer_payment_by || "",
  };
  document.getElementById("phone").value = order.phone || "";
  document.getElementById("phone").dispatchEvent(new Event("input", { bubbles: true }));
  document.getElementById("client").value = order.client || "";
  const orderTypeEl = document.getElementById("order_type");
  if (orderTypeEl) orderTypeEl.value = order.order_type || "";
  document.getElementById("address").value = order.address || "";
  const statusVal = order.payment_status || "";
  const displayStatus = statusVal === "нет" || statusVal === "оплачен" || !statusVal
    ? ""
    : statusVal;
  const paymentStatusEl = document.getElementById("payment_status");
  if (paymentStatusEl) {
    paymentStatusEl.value = displayStatus;
    if (paymentStatusEl.value !== displayStatus) paymentStatusEl.value = ""; /* fallback if option missing */
  }
  state.initialPaymentStatus = displayStatus;
  const orderDateVal = order.order_date || "";
  const orderDateEl = document.getElementById("order_date");
  const orderTimeEl = document.getElementById("order_time");
  if (orderDateEl && orderTimeEl) {
    if (orderDateVal.includes("T")) {
      const datePart = orderDateVal.slice(0, 10);
      orderDateEl.value = /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? formatDateDDMMYYYY(datePart) : "";
      const tm = orderDateVal.match(/T(\d{2}):(\d{2})/);
      orderTimeEl.value = tm ? `${tm[1]}:${tm[2]}` : "00:00";
    } else if (orderDateVal && /^\d{4}-\d{2}-\d{2}$/.test(orderDateVal.slice(0, 10))) {
      orderDateEl.value = formatDateDDMMYYYY(orderDateVal.slice(0, 10));
      orderTimeEl.value = "00:00";
    } else {
      orderDateEl.value = "";
      orderTimeEl.value = "00:00";
    }
  }
  const orderNumberEl = document.getElementById("order_number");
  if (orderNumberEl) orderNumberEl.value = order.order_number || "";
  document.getElementById("description").value = order.description ?? "";
  document.getElementById("amount").value = order.amount != null
    ? formatOrderFormNumberValue(order.amount, ORDER_FORM_NUMERIC_FIELD_DECIMALS.amount)
    : "";
  document.getElementById("prepayment").value = order.prepayment != null
    ? formatOrderFormNumberValue(order.prepayment, ORDER_FORM_NUMERIC_FIELD_DECIMALS.prepayment)
    : "";
  document.getElementById("prepayment_to").value = order.prepayment_to || "";
  document.getElementById("remaining_amount").value = order.remaining_amount != null
    ? formatOrderFormNumberValue(order.remaining_amount, ORDER_FORM_NUMERIC_FIELD_DECIMALS.remaining_amount)
    : "";
  document.getElementById("remaining_to").value = order.remaining_to || "";
  document.getElementById("area_m2").value = order.area_m2 != null
    ? formatOrderFormNumberValue(order.area_m2, ORDER_FORM_NUMERIC_FIELD_DECIMALS.area_m2)
    : "";
  populateOrderFormInstallerSelect(order.installer_name || "");
  const installerAmountEl = document.getElementById("installer_payment_amount");
  if (installerAmountEl) installerAmountEl.value = order.installer_payment_amount != null
    ? formatOrderFormNumberValue(order.installer_payment_amount, ORDER_FORM_NUMERIC_FIELD_DECIMALS.installer_payment_amount)
    : "";
  const installerByEl = document.getElementById("installer_payment_by");
  if (installerByEl) installerByEl.value = order.installer_payment_by || "";
  document.getElementById("mosquito_nets").value = order.mosquito_nets != null
    ? formatOrderFormNumberValue(order.mosquito_nets, ORDER_FORM_NUMERIC_FIELD_DECIMALS.mosquito_nets)
    : "";
  document.getElementById("construction_count").value = order.construction_count != null
    ? formatOrderFormNumberValue(order.construction_count, ORDER_FORM_NUMERIC_FIELD_DECIMALS.construction_count)
    : "";
  document.getElementById("delivery").value = order.delivery || "";
  const deliveryDateEl = document.getElementById("delivery_date");
  if (deliveryDateEl) {
    const dd = order.delivery_date;
    deliveryDateEl.value =
      dd && typeof dd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dd.slice(0, 10))
        ? formatDateDDMMYYYY(dd.slice(0, 10))
        : "";
  }
  const installationCb = document.getElementById("installation");
  const installationDateWrap = document.getElementById("installationDateWrap");
  const installationDateInput = document.getElementById("installation_date");
  if (installationCb) installationCb.checked = !!order.installation;
  if (installationDateWrap) installationDateWrap.style.display = order.installation ? "" : "none";
  if (installationDateInput) {
    const id = order.installation_date;
    installationDateInput.value =
      id && typeof id === "string" && /^\d{4}-\d{2}-\d{2}$/.test(id.slice(0, 10))
        ? formatDateDDMMYYYY(id.slice(0, 10))
        : "";
  }
  updateInstallerBlockByInstallationDate();
  const revealsCb = document.getElementById("reveals");
  const revealsDateWrap = document.getElementById("revealsDateWrap");
  const revealsDateInput = document.getElementById("reveals_date");
  if (revealsCb) revealsCb.checked = !!order.reveals;
  if (revealsDateWrap) revealsDateWrap.style.display = order.reveals ? "" : "none";
  if (revealsDateInput) {
    const rd = order.reveals_date;
    revealsDateInput.value =
      rd && typeof rd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rd.slice(0, 10))
        ? formatDateDDMMYYYY(rd.slice(0, 10))
        : "";
  }

  ["order_date", "delivery_date", "installation_date", "reveals_date"].forEach((id) => {
    syncOrderFormTextFieldToNativePicker(id);
  });

  updatePaidField();
  updateConditionalRequiredHighlight();
  updateOrderFormDateFieldHighlights(false);
  resetFileUpload();
  void renderExistingOrderFilesInForm(order.id).catch((err) => {
    console.error("Список файлов заявки:", err);
    clearExistingOrderFilesInForm();
  });
  await checkInstallerPaymentDone(order.id);
  applyOrderFormFieldsVisibilityForRole();
  bindMoneyRecipientSelectRoleGuards();
  applyMoneyRecipientSelectsForRole();
  state.initialOrderSnapshot = JSON.parse(JSON.stringify(getFormData()));
}

/** Снимок disabled у полей формы заказа для режима «только просмотр». */
let orderFormReadOnlyRestore = null;

/**
 * Все поля формы заказа только для чтения или снова редактируемые.
 * Кнопки «Сохранить» скрываются отдельно в viewOrder.
 */
export function applyOrderFormReadOnly(readOnly) {
  const formEl = document.getElementById("orderForm");
  if (!formEl) return;

  if (readOnly) {
    if (orderFormReadOnlyRestore) {
      orderFormReadOnlyRestore.forEach((wasDisabled, el) => {
        el.disabled = wasDisabled;
      });
      orderFormReadOnlyRestore = null;
    }
    orderFormReadOnlyRestore = new Map();
    formEl.querySelectorAll("input, select, textarea, button").forEach((el) => {
      if (el.type === "hidden") return;
      if (el.id === "submitBtn" || el.id === "submitBtnTop") return;
      orderFormReadOnlyRestore.set(el, el.disabled);
      el.disabled = true;
    });
    formEl.querySelectorAll(".order-form-date-calendar-btn").forEach((el) => {
      el.dataset.orderFormReadonlyPe = el.style.pointerEvents || "";
      el.style.pointerEvents = "none";
    });
    return;
  }

  if (orderFormReadOnlyRestore) {
    orderFormReadOnlyRestore.forEach((wasDisabled, el) => {
      el.disabled = wasDisabled;
    });
    orderFormReadOnlyRestore = null;
  }
  formEl.querySelectorAll(".order-form-date-calendar-btn").forEach((el) => {
    el.style.pointerEvents = el.dataset.orderFormReadonlyPe || "";
    delete el.dataset.orderFormReadonlyPe;
  });
  updateInstallerBlockByInstallationDate();
  updatePaidField();
}

function captureOrderFormReturnSection() {
  const cur = getCurrentSectionId();
  if (cur && cur !== "new") {
    state.orderFormReturnSectionId = cur;
  }
}

function resolveOrderFormReturnSectionId(stored) {
  const id = stored ?? null;
  if (id && id !== "new" && id !== STANDALONE_SECTION_NAV_ID) {
    return id;
  }
  return "all";
}

/** Сбросить «липкий» режим просмотра/редактирования до смены раздела (user-place / restore). */
function clearStickyOrderFormIds() {
  state.editingOrderId = null;
  state.viewingOrderId = null;
  state.orderFormReturnSectionId = null;
  hideOrderViewQr();
  syncOrderIdInUrl(null);
}

async function applyPostOrderFormNavigation(returnSectionId, { savedOrderId = null, reloadOrders = true } = {}) {
  const target = resolveOrderFormReturnSectionId(returnSectionId);
  // Сначала снять editing/viewing, иначе scheduleSaveUserPlace / restoreSavedAppContext
  // снова вернут на форму изменения того же заказа.
  clearStickyOrderFormIds();
  // Защита от resume: если до debounce случится reload на «/», не вернуть на /new.
  markSkipUserPlaceResume();
  // Затем уйти с формы: иначе resetFormMode() показывает «Новая заявка»,
  // а loadOrders() на мобильном может занять несколько секунд до switchSection.
  switchSection(target);
  rememberUserPlaceNow(pathForRouteSection(target), {
    sectionId: target,
    viewingOrderId: null,
    editingOrderId: null,
  });
  resetFormMode();
  if (!reloadOrders) return;
  await loadOrders();
  if (target === "all" && savedOrderId != null) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => highlightAndFocusSavedOrderRow(savedOrderId));
    });
  }
}

export async function leaveOrderFormAfterSave(savedOrderId) {
  const returnSectionId = state.orderFormReturnSectionId;
  await applyPostOrderFormNavigation(returnSectionId, { savedOrderId });
}

export function leaveOrderFormOnCancel() {
  const returnSectionId = state.orderFormReturnSectionId;
  void applyPostOrderFormNavigation(returnSectionId, { reloadOrders: false });
}

/** Уйти с формы просмотра/редактирования в указанный раздел (меню / кнопка «Заказы»). */
export function leaveOrderFormToSection(sectionId) {
  void applyPostOrderFormNavigation(sectionId, { reloadOrders: false });
}

/** Есть ли активный режим формы заказа (просмотр или изменение). */
export function isOrderFormSessionActive() {
  return state.editingOrderId != null || state.viewingOrderId != null;
}

export function resetFormMode() {
  state.viewingOrderId = null;
  hideOrderViewQr();
  syncOrderIdInUrl(null);
  applyOrderFormReadOnly(false);
  state.editingOrderId = null;
  state.orderFormReturnSectionId = null;
  state.editingOrderDescription = null;
  state.initialPaymentStatus = null;
  state.initialOrderSums = null;
  state.initialOrderParticipants = null;
  state.initialOrderSnapshot = null;
  state.installerPaymentDone = false;
  document.getElementById("orderForm").reset();
  updatePaidField();
  updateConditionalRequiredHighlight();
  const inst = getInstallerPaymentElements();
  if (inst.amountEl) inst.amountEl.value = "";
  if (inst.byEl) inst.byEl.value = "";
  populateOrderFormInstallerSelect("");
  setInstallerPaymentBlockDisabled(false);
  const ratePerM2El = document.getElementById("installer_rate_per_m2");
  if (ratePerM2El) {
    ratePerM2El.value = formatOrderFormNumberValue(
      state.defaultInstallerRatePerM2 ?? 1400,
      ORDER_FORM_NUMERIC_FIELD_DECIMALS.installer_rate_per_m2
    );
  }
  const orderDateInput = document.getElementById("order_date");
  const orderTimeInput = document.getElementById("order_time");
  if (orderDateInput && orderTimeInput) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    orderDateInput.value = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`;
    orderTimeInput.value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }
  const installationCb = document.getElementById("installation");
  const installationDateWrap = document.getElementById("installationDateWrap");
  const installationDateInput = document.getElementById("installation_date");
  if (installationCb) installationCb.checked = false;
  if (installationDateWrap) installationDateWrap.style.display = "none";
  if (installationDateInput) installationDateInput.value = "";
  updateInstallerBlockByInstallationDate();
  const revealsCb = document.getElementById("reveals");
  const revealsDateWrap = document.getElementById("revealsDateWrap");
  const revealsDateInput = document.getElementById("reveals_date");
  if (revealsCb) revealsCb.checked = false;
  if (revealsDateWrap) revealsDateWrap.style.display = "none";
  if (revealsDateInput) revealsDateInput.value = "";
  const deliveryDateReset = document.getElementById("delivery_date");
  if (deliveryDateReset) deliveryDateReset.value = "";
  ["order_date", "delivery_date", "installation_date", "reveals_date"].forEach((id) => {
    syncOrderFormTextFieldToNativePicker(id);
  });
  updateOrderFormDateFieldHighlights(false);
  const phoneEl = document.getElementById("phone");
  if (phoneEl) phoneEl.dispatchEvent(new Event("input", { bubbles: true }));
  resetFileUpload();
  clearExistingOrderFilesInForm();

  setMessage("Режим: новая заявка", "");

  refreshSectionNavLabel();
  if (submitBtn) submitBtn.textContent = "Сохранить заказ";
  if (submitBtnTop) submitBtnTop.textContent = "Сохранить заказ";
  setOrderFormSaveButtonsBusy(false);

  if (formTitle) {
    formTitle.textContent = "Новая заявка";
  }

  if (cancelEditBtn) cancelEditBtn.style.display = "inline-block";
  if (cancelEditBtnTop) cancelEditBtnTop.style.display = "inline-block";
  if (submitBtn) submitBtn.style.display = "";
  if (submitBtnTop) submitBtnTop.style.display = "";

  applyOrderTypeSelectForRole();
  applyOrderFormFieldsVisibilityForRole();
  bindMoneyRecipientSelectRoleGuards();
  applyMoneyRecipientSelectsForRole();
}

async function loadOrderRowForForm(orderId) {
  const idNum = Number(orderId);
  const fromList = state.allOrders.find((x) => Number(x.id) === idNum);
  if (fromList && (isOfflineDataMode() || isOfflineClientOrderId(idNum))) {
    return fromList;
  }
  try {
    const res = await raceWithTimeout(
      supabaseClient.from("orders").select("*").eq("id", orderId).single(),
    );
    if (!res.error && res.data) return res.data;
    if (fromList) return fromList;
    return { error: res.error || new Error("not found") };
  } catch (e) {
    if (fromList) return fromList;
    throw e;
  }
}

/** Просмотр заказа: та же форма, что при редактировании, без изменения данных. */
export async function viewOrder(orderId) {
  state.editingOrderId = null;
  state.viewingOrderId = orderId;

  let data = null;
  try {
    data = await loadOrderRowForForm(orderId);
  } catch (e) {
    console.error("Ошибка загрузки заявки:", e);
    setMessage("Ошибка загрузки заявки", "#d32f2f");
    state.viewingOrderId = null;
    hideOrderViewQr();
    syncOrderIdInUrl(null);
    return;
  }
  if (data?.error) {
    console.error("Ошибка загрузки заявки:", data.error);
    setMessage("Ошибка загрузки заявки", "#d32f2f");
    state.viewingOrderId = null;
    hideOrderViewQr();
    syncOrderIdInUrl(null);
    return;
  }

  if (isOrderHiddenForCurrentRole(data)) {
    setMessage("Нет доступа к этому типу заказа", "#d32f2f");
    state.viewingOrderId = null;
    hideOrderViewQr();
    syncOrderIdInUrl(null);
    return;
  }

  await fillForm(data);
  applyOrderFormReadOnly(true);
  setMessage("", "");

  if (submitBtn) {
    submitBtn.style.display = "none";
    submitBtn.textContent = "Сохранить заказ";
  }
  if (submitBtnTop) {
    submitBtnTop.style.display = "none";
    submitBtnTop.textContent = "Сохранить заказ";
  }
  if (cancelEditBtn) cancelEditBtn.style.display = "none";
  if (cancelEditBtnTop) cancelEditBtnTop.style.display = "none";

  if (formTitle) {
    formTitle.textContent = `Просмотр ${formatOrderIdTypeChip(orderId, data.order_type)}`;
  }

  captureOrderFormReturnSection();
  switchSection("new", { skipAccessLog: true });
  syncOrderIdInUrl(orderId);
  logOrderPageAccess({ orderId, mode: "view" });
  await showOrderViewQr(orderId);
  refreshSectionNavLabel();

  window.scrollTo({ top: 0, behavior: "smooth" });
  scheduleSaveUserPlace();
}

export async function editOrder(orderId) {
  if (!canMutateOrders()) {
    setMessage("Недостаточно прав для редактирования заявок", "#d32f2f");
    return;
  }

  state.viewingOrderId = null;
  hideOrderViewQr();
  syncOrderIdInUrl(null);
  applyOrderFormReadOnly(false);

  let data = null;
  try {
    data = await loadOrderRowForForm(orderId);
  } catch (e) {
    console.error("Ошибка загрузки заявки:", e);
    setMessage("Ошибка загрузки заявки", "#d32f2f");
    return;
  }
  if (data?.error) {
    console.error("Ошибка загрузки заявки:", data.error);
    setMessage("Ошибка загрузки заявки", "#d32f2f");
    return;
  }

  if (isOrderHiddenForCurrentRole(data)) {
    setMessage("Нет доступа к этому типу заказа", "#d32f2f");
    return;
  }

  if (isUserLite() && isOrderEditLockedForUserLite(data)) {
    setMessage("Редактирование этого заказа для вашей роли отключено", "#d32f2f");
    return;
  }

  state.editingOrderId = orderId;
  state.editingOrderDescription = data.description || null;
  await fillForm(data);
  setMessage("", "");

  if (submitBtn) {
    submitBtn.style.display = "";
    submitBtn.textContent = "Сохранить изменения";
  }
  if (submitBtnTop) {
    submitBtnTop.style.display = "";
    submitBtnTop.textContent = "Сохранить изменения";
  }
  setOrderFormSaveButtonsBusy(false);

  if (formTitle) {
    formTitle.textContent = `Редактирование ${formatOrderIdTypeChip(orderId, data.order_type)}`;
  }

  if (cancelEditBtn) cancelEditBtn.style.display = "inline-block";
  if (cancelEditBtnTop) cancelEditBtnTop.style.display = "inline-block";

  captureOrderFormReturnSection();
  switchSection("new", { skipAccessLog: true });
  logOrderPageAccess({ orderId, mode: "edit" });

  window.scrollTo({ top: 0, behavior: "smooth" });
  scheduleSaveUserPlace();
}

export async function deleteOrder(orderId) {
  if (!canDeleteOrders()) return;

  const idNum = Number(orderId);

  if (state.ordersFromCache && !isOfflineClientOrderId(idNum)) {
    setMessage("В режиме локальной копии нельзя удалять заявки с сервера", "#d32f2f");
    return;
  }

  if (isOfflineClientOrderId(idNum)) {
    const order = state.allOrders.find((x) => Number(x.id) === idNum);
    const localId = order?.__offlineLocalId;
    if (!localId) return;
    const chip = formatOrderIdTypeChip(idNum, order?.order_type);
    const ok = confirm(`Удалить несинхронизированную заявку ${chip}?`);
    if (!ok) return;
    removePendingByLocalId(localId);
    rebaselineAllOrdersFromStateAndPendingQueue();
    setMessage("Заявка удалена из локальной очереди", "");
    return;
  }

  const ok = confirm(`Удалить заявку #${orderId}?`);
  if (!ok) return;

  const { error } = await supabaseClient
    .from("orders")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", orderId);

  if (error) {
    console.error("Ошибка удаления:", error);
    setMessage("Ошибка при удалении", "#d32f2f");
    return;
  }

  if (state.currentUser?.email) {
    const { error: histError } = await supabaseClient.from("order_history").insert([
      { order_id: orderId, user_email: state.currentUser.email, comment: "Заявка удалена" },
    ]);
    if (histError) {
      console.error("Ошибка записи в историю изменений:", histError);
    }
  }

  setMessage(`Заявка #${orderId} удалена`, "");
  await loadOrders();
}

/** Сохранить правку существующего заказа с сервера в локальную очередь (офлайн).
 *  @returns {boolean} true — ушли с формы / сохранили в очередь; false — нечего сохранять. */
function commitServerOrderEditToOfflineStorage(orderData) {
  const orderId = Number(state.editingOrderId);
  const historyComment = buildOrderHistoryComment(state.initialOrderSnapshot, orderData, true);
  if (historyComment === "Сохранено без изменений") {
    setMessage("Нет изменений для сохранения", "");
    return false;
  }
  const changedAt = new Date().toISOString();
  addOrAppendPendingServerOrderEdit({
    orderId,
    orderData,
    prevSnapshot: state.initialOrderSnapshot,
    historyComment,
    user_email: state.currentUser?.email || "",
    changedAt,
    initialSums: state.initialOrderSums,
    initialParticipants: state.initialOrderParticipants,
  });
  queueOrderDeltaCalculationsForOffline({
    orderTempId: orderId,
    wasEditing: true,
    initialSums: state.initialOrderSums,
    initialParticipants: state.initialOrderParticipants,
    orderData,
  });
  state.dbUnavailable = true;
  state.ordersFromCache = true;
  rebaselineAllOrdersFromStateAndPendingQueue();
  syncDbUnavailableBanner();
  void leaveOrderFormAfterSave(orderId);
  setMessage("Изменения сохранены на устройстве; отправка в базу при появлении связи.", "#92400e");
  return true;
}

/** Сохранить заказ только в localStorage (очередь офлайн). editingOffline — правка существующей офлайн-заявки. */
function commitOrderFormToOfflineStorage(orderData, editingOffline) {
  const insertPayload = insertPayloadFromFormData(orderData);
  let highlightId;

  if (!editingOffline) {
    const localId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tempId = nextOfflineTempOrderId();
    const displayRow = buildDisplayRowForPendingOrder(orderData, tempId, localId);
    addPendingOfflineOrder({ localId, displayRow, insertPayload });
    const histLocalId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `hist-${Date.now()}`;
    addPendingOfflineOrderHistory({
      localId: histLocalId,
      pending_order_local_id: localId,
      order_temp_id: tempId,
      user_email: state.currentUser?.email || "",
      comment: buildOrderHistoryComment(null, orderData, false),
    });
    highlightId = tempId;
  } else {
    const cur = state.allOrders.find((x) => x.id === state.editingOrderId);
    const localId = cur?.__offlineLocalId;
    if (!localId) {
      setMessage("Не удалось обновить локальную заявку", "#d32f2f");
      return;
    }
    const displayRow = buildDisplayRowForPendingOrder(orderData, state.editingOrderId, localId);
    updatePendingOfflineOrder(localId, displayRow, insertPayload);
    const histLocalId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `hist-${Date.now()}`;
    addPendingOfflineOrderHistory({
      localId: histLocalId,
      pending_order_local_id: localId,
      order_temp_id: state.editingOrderId,
      user_email: state.currentUser?.email || "",
      comment: buildOrderHistoryComment(state.initialOrderSnapshot, orderData, true),
    });
    highlightId = state.editingOrderId;
  }

  const orderTempIdForCalcs = editingOffline ? state.editingOrderId : highlightId;
  queueOrderDeltaCalculationsForOffline({
    orderTempId: orderTempIdForCalcs,
    wasEditing: editingOffline,
    initialSums: editingOffline ? state.initialOrderSums : undefined,
    initialParticipants: editingOffline ? state.initialOrderParticipants : undefined,
    orderData,
  });

  state.dbUnavailable = true;
  state.ordersFromCache = true;
  rebaselineAllOrdersFromStateAndPendingQueue();
  syncDbUnavailableBanner();
  void leaveOrderFormAfterSave(highlightId);
  setMessage(
    editingOffline
      ? "Изменения сохранены на устройстве; отправка в базу при появлении связи."
      : "Заявка сохранена на устройстве; отправка в базу при появлении связи.",
    "#92400e"
  );
}

/** Флаг и UI-блокировка кнопок «Сохранить», чтобы не создавать дубликаты при повторных нажатиях. */
let orderFormSaveInFlight = false;

function setOrderFormSaveButtonsBusy(busy) {
  orderFormSaveInFlight = Boolean(busy);
  for (const btn of [submitBtn, submitBtnTop]) {
    if (!btn) continue;
    btn.disabled = orderFormSaveInFlight;
    if (orderFormSaveInFlight) {
      btn.setAttribute("aria-busy", "true");
    } else {
      btn.removeAttribute("aria-busy");
    }
  }
}

export async function submitOrderForm(event) {
  event.preventDefault();
  setOrderFormInvalidDateMessage(false);

  if (orderFormSaveInFlight) {
    return;
  }

  // Сразу блокируем обе кнопки (верх и низ), чтобы повторные клики при медленной сети
  // не создавали дубликаты заказов.
  setOrderFormSaveButtonsBusy(true);
  let saveFinishedOk = false;

  try {
  if (state.viewingOrderId != null) {
    return;
  }

  if (!canMutateOrders()) {
    setMessage("Недостаточно прав для сохранения заявок", "#d32f2f");
    return;
  }

  const orderTypeForSave = (document.getElementById("order_type")?.value || "").trim();
  if (isUserLite() && orderTypeForSave === "Магазин") {
    setMessage("Тип заказа «Магазин» недоступен для вашей роли", "#d32f2f");
    return;
  }
  if (isUserShop() && orderTypeForSave !== "Магазин") {
    setMessage("Для вашей роли доступен только тип заказа «Магазин»", "#d32f2f");
    return;
  }

  if (state.editingOrderId && isUserLite() && !isOfflineClientOrderId(state.editingOrderId)) {
    if (state.ordersFromCache) {
      const lockRow = state.allOrders.find((x) => Number(x.id) === Number(state.editingOrderId));
      if (lockRow && isOrderEditLockedForUserLite(lockRow)) {
        setMessage("Редактирование этого заказа для вашей роли отключено", "#d32f2f");
        return;
      }
    } else {
      try {
        const { data: lockRow, error: lockErr } = await supabaseClient
          .from("orders")
          .select("lock_edit_for_user_lite")
          .eq("id", state.editingOrderId)
          .single();
        if (!lockErr && lockRow && isOrderEditLockedForUserLite(lockRow)) {
          setMessage("Редактирование этого заказа для вашей роли отключено", "#d32f2f");
          return;
        }
      } catch (e) {
        if (!isNetworkFetchError(e)) throw e;
        const lockRow = state.allOrders.find((x) => Number(x.id) === Number(state.editingOrderId));
        if (lockRow && isOrderEditLockedForUserLite(lockRow)) {
          setMessage("Редактирование этого заказа для вашей роли отключено", "#d32f2f");
          return;
        }
      }
    }
  }

  const phoneVal = (document.getElementById("phone")?.value || "").trim();
  const clientVal = (document.getElementById("client")?.value || "").trim();
  const addressVal = (document.getElementById("address")?.value || "").trim();

  if (!clientVal) {
    setMessage("Не заполнено Клиент", "#d32f2f");
    document.getElementById("client")?.classList.add("client-invalid");
    return;
  }
  document.getElementById("client")?.classList.remove("client-invalid");

  if (!addressVal) {
    setMessage("Не заполнено Адрес", "#d32f2f");
    document.getElementById("address")?.classList.add("address-invalid");
    return;
  }
  document.getElementById("address")?.classList.remove("address-invalid");

  const statusVal = (document.getElementById("payment_status")?.value || "").trim();
  if (!statusVal) {
    setMessage("Не заполнено Статус", "#d32f2f");
    document.getElementById("payment_status")?.classList.add("payment-status-invalid");
    return;
  }
  document.getElementById("payment_status")?.classList.remove("payment-status-invalid");

  if (statusVal === "Заказ закрыт" && !isAdmin() && state.currentRole !== "user") {
    setMessage("Статус «Заказ закрыт» доступен только ролям admin и user", "#d32f2f");
    return;
  }

  // Правило: нельзя ставить "Заказ закрыт", если "Оплачено" = "нет"
  // "Оплачено" вычисляется от поля "Кому остаток" через updatePaidField().
  updatePaidField();
  const paidVal = document.getElementById("paid")?.value;
  if (statusVal === "Заказ закрыт" && paidVal === "нет") {
    setMessage("Заказ нельзя закрыть, если он не оплачен", "#d32f2f");
    return;
  }

  if (phoneVal && !isValidOrderPhone(phoneVal)) {
    setMessage("Неверный формат телефона.", "#d32f2f");
    document.getElementById("phone")?.classList.add("phone-invalid");
    return;
  }

  if (hasInvalidOrderFormDateInput()) {
    updateOrderFormDateFieldHighlights(true);
    setOrderFormInvalidDateMessage(true);
    return;
  }

  const prepaymentVal = (document.getElementById("prepayment")?.value || "").trim();
  const prepaymentToVal = (document.getElementById("prepayment_to")?.value || "").trim();
  const remainingToVal = (document.getElementById("remaining_to")?.value || "").trim();
  const initialParticipants = state.initialOrderParticipants || {};
  if (
    isForbiddenKassaBeznalSelection(prepaymentToVal, initialParticipants.prepayment_to) ||
    isForbiddenKassaBeznalSelection(remainingToVal, initialParticipants.remaining_to)
  ) {
    setMessage("«Касса» и «Безнал» доступны только ролям admin и user", "#d32f2f");
    return;
  }
  const conditionalMissing = [];
  if (prepaymentVal && !prepaymentToVal) conditionalMissing.push("Кому предоплата");
  const deliveryVal = (document.getElementById("delivery")?.value || "").trim();
  const deliveryDateVal = (document.getElementById("delivery_date")?.value || "").trim();
  if (deliveryVal && !parseOrderFormDdMmYyyyToIso(deliveryDateVal)) conditionalMissing.push("Дата");
  if (conditionalMissing.length > 0) {
    setMessage("Заполните поля: " + conditionalMissing.join(", "), "#d32f2f");
    updateConditionalRequiredHighlight();
    return;
  }

  for (const id of RUBLE_INTEGER_ORDER_FIELD_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    const r = tryParseRublesInteger(el.value);
    if (r.invalidFormat) {
      el.classList.add("sum-input-invalid");
      el.title = MSG_SUM_INTEGER_ONLY;
      el.setAttribute("aria-invalid", "true");
      setMessage(MSG_SUM_INTEGER_ONLY, "#d32f2f");
      return;
    }
  }

  // Правило: Предоплата не может быть больше стоимости.
  const amountNum = tryParseRublesInteger(document.getElementById("amount")?.value).value;
  const prepaymentNum = tryParseRublesInteger(document.getElementById("prepayment")?.value).value;
  if (amountNum != null && prepaymentNum != null && prepaymentNum > amountNum) {
    setMessage("Предоплата не может быть больше суммы заказа", "#d32f2f");
    return;
  }

  setMessage("Сохраняю...", "");

  const orderData = getFormData();

  const saveLocalNew = !state.editingOrderId && shouldSaveNewOrderToLocalQueue();
  const saveLocalEdit = Boolean(state.editingOrderId && isOfflineClientOrderId(state.editingOrderId));
  const saveLocalServerEdit = Boolean(
    state.editingOrderId && !isOfflineClientOrderId(state.editingOrderId) && isOfflineDataMode(),
  );

  if (saveLocalNew || saveLocalEdit) {
    commitOrderFormToOfflineStorage(orderData, saveLocalEdit);
    saveFinishedOk = true;
    return;
  }
  if (saveLocalServerEdit) {
    if (!commitServerOrderEditToOfflineStorage(orderData)) {
      return;
    }
    saveFinishedOk = true;
    return;
  }

  let error = null;
  let savedOrderId = state.editingOrderId;
  const wasEditing = Boolean(state.editingOrderId);

  try {
    if (state.editingOrderId) {
      const result = await raceWithTimeout(
        supabaseClient.from("orders").update(orderData).eq("id", state.editingOrderId).select().single(),
      );

      error = result.error;

      if (!error && result.data) {
        savedOrderId = result.data.id;
      }
    } else {
      const result = await raceWithTimeout(
        supabaseClient.from("orders").insert([orderData]).select().single(),
      );

      error = result.error;

      if (!error && result.data) {
        savedOrderId = result.data.id;
      }
    }
  } catch (e) {
    error = e;
  }

  if (error && !wasEditing && shouldFallbackSaveOrderToLocal(error)) {
    applyOfflineModeFromDbUnavailable();
    commitOrderFormToOfflineStorage(orderData, false);
    saveFinishedOk = true;
    return;
  }

  if (
    error &&
    wasEditing &&
    state.editingOrderId &&
    !isOfflineClientOrderId(state.editingOrderId) &&
    shouldFallbackSaveOrderToLocal(error)
  ) {
    applyOfflineModeFromDbUnavailable();
    if (!commitServerOrderEditToOfflineStorage(orderData)) {
      return;
    }
    saveFinishedOk = true;
    return;
  }

  if (error) {
    console.error("Ошибка сохранения:", error);
    const detail = error.message || error.hint || String(error.code);
    setMessage((wasEditing ? "Ошибка при обновлении заявки. " : "Ошибка при сохранении заявки. ") + detail, "#d32f2f");
    return;
  }

  await uploadFiles(savedOrderId);

  await writeOrderDeltaCalculations({
    orderId: savedOrderId,
    wasEditing,
    initialSums: state.initialOrderSums,
    initialParticipants: state.initialOrderParticipants,
    orderData,
  });

  if (savedOrderId && state.currentUser?.email) {
    const historyComment = buildOrderHistoryComment(
      wasEditing ? state.initialOrderSnapshot : null,
      orderData,
      wasEditing
    );
    await supabaseClient.from("order_history").insert([
      { order_id: savedOrderId, user_email: state.currentUser.email, comment: historyComment },
    ]);
  }

  await leaveOrderFormAfterSave(savedOrderId);
  saveFinishedOk = true;

  setMessage(
    wasEditing
    ? `Заявка #${savedOrderId} обновлена`
    : `Заявка #${savedOrderId} сохранена`,
    ""
  );
  } finally {
    // При ошибке/валидации снова разрешаем сохранить; при успехе кнопки остаются
    // заблокированными до resetFormMode / editOrder.
    if (!saveFinishedOk) {
      setOrderFormSaveButtonsBusy(false);
    }
  }
}

function highlightAndFocusSavedOrderRow(orderId) {
  if (orderId == null) return;
  const ordersTable = document.getElementById("ordersTable");
  if (!ordersTable) return;
  const tbody = ordersTable.querySelector("tbody");
  if (!tbody) return;

  const idStr = String(orderId);
  const idTd = tbody
    .querySelector(`td.td-order-id[data-order-id="${CSS.escape(idStr)}"]`);
  const tr = idTd?.closest("tr");
  if (!tr) return;

  // Подсветить (голубая заливка из CSS для tr.row-highlighted td)
  tbody.querySelectorAll("tr.row-highlighted").forEach((row) => row.classList.remove("row-highlighted"));
  tr.classList.add("row-highlighted");

  // Вертикальный фокус: прокрутить контейнер так, чтобы строка была в центре.
  const scrollOuter = document.getElementById("ordersTableScrollBottom");
  if (scrollOuter && typeof tr.scrollIntoView === "function") {
    try {
      tr.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch {
      tr.scrollIntoView({ block: "center" });
    }
  }

  // Горизонтальный фокус: подвинуть scroll так, чтобы левая ячейка строки была видна слева.
  const scrollInner = document.getElementById("ordersTableScrollInner");
  const scrollTop = document.getElementById("ordersTableScrollTop");
  if (scrollInner && idTd) {
    const innerRect = scrollInner.getBoundingClientRect();
    const tdRect = idTd.getBoundingClientRect();
    const diff = tdRect.left - innerRect.left;

    if (Number.isFinite(diff)) {
      const target = Math.max(0, scrollInner.scrollLeft + diff);
      scrollInner.scrollLeft = target;
      if (scrollTop) scrollTop.scrollLeft = target;
    } else if (typeof idTd.offsetLeft === "number") {
      const target = Math.max(0, idTd.offsetLeft);
      scrollInner.scrollLeft = target;
      if (scrollTop) scrollTop.scrollLeft = target;
    }
  }
}

/** Полный HTML опций «Тип заказа» до ограничений по роли (восстановление после user_shop). */
let orderTypeSelectHtmlBackup = null;

/** Скрыть в форме тип «Магазин» для роли user_lite и обновить фильтр по типам. Для user_shop в списке только «Магазин» (hidden у option в select не работает в типичных браузерах). */
export function applyOrderTypeSelectForRole() {
  const sel = document.getElementById("order_type");
  if (!sel) return;

  if (orderTypeSelectHtmlBackup == null) {
    orderTypeSelectHtmlBackup = sel.innerHTML;
  }

  if (isUserShop()) {
    sel.innerHTML = '<option value="Магазин">Магазин</option>';
  } else {
    sel.innerHTML = orderTypeSelectHtmlBackup;
    for (const opt of sel.querySelectorAll("option")) {
      if (opt.value === "Магазин") opt.hidden = isUserLite();
      else opt.hidden = false;
    }
  }

  if (isUserLite() && state.orderTypeFilterSelected?.length) {
    state.orderTypeFilterSelected = state.orderTypeFilterSelected.filter((k) => k !== "Магазин");
  }
  if (isUserShop()) {
    state.orderTypeFilterSelected = [];
    if (!state.editingOrderId && state.viewingOrderId == null) {
      sel.value = "Магазин";
    } else if (!isShopOrder({ order_type: sel.value })) {
      sel.value = "Магазин";
    }
  }
  renderOrderTypeFilterDropdown();
  applyFiltersAndRender();
}

const VOICE_ORDER_TYPES = new Set(["Окна", "Подоконники", "Аллюминий", "Магазин", "Сетки/мелочь"]);
const VOICE_PAYMENT_STATUSES = new Set([
  "Контакт с клиентом",
  "Замер назначен",
  "Замер проведен",
  "Расчет сформирован",
  "Предложение направлено",
  "Клиент согласен",
  "Производство",
  "Товар передан заказчику",
  "Монтаж выполнен",
  "Заказ закрыт",
]);
const VOICE_MONEY_TO = new Set(["Дима", "Вова", "Безнал", "Касса"]);
const VOICE_DELIVERY = new Set(["Доставка", "Самовывоз"]);

function normalizeVoiceMoneyTo(raw) {
  const s = String(raw || "").trim();
  return VOICE_MONEY_TO.has(s) ? s : null;
}

function normalizeVoiceInteger(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.round(raw);
  const r = tryParseRublesInteger(String(raw));
  if (r.invalidFormat) return null;
  return r.value;
}

function normalizeVoiceIsoDate(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

/**
 * Создать заказ из голосового ассистента (без открытия формы).
 * @param {Record<string, unknown>} draft
 * @returns {Promise<{ ok: boolean, orderId?: number|string, message: string, offline?: boolean }>}
 */
export async function createOrderFromVoicePayload(draft) {
  if (!canMutateOrders()) {
    return { ok: false, message: "Недостаточно прав для создания заказов" };
  }

  const client = String(draft?.client || "").trim();
  if (!client) {
    return { ok: false, message: "Не указан клиент" };
  }

  const address = String(draft?.address || "").trim();
  if (!address) {
    return { ok: false, message: "Не указан адрес" };
  }

  let paymentStatus = String(draft?.payment_status || "").trim();
  if (!paymentStatus) {
    return { ok: false, message: "Не указан статус" };
  }
  if (!VOICE_PAYMENT_STATUSES.has(paymentStatus)) {
    return { ok: false, message: "Неизвестный статус. Укажите один из допустимых статусов." };
  }
  if (paymentStatus === "Заказ закрыт" && !isAdmin() && state.currentRole !== "user") {
    return { ok: false, message: "Статус «Заказ закрыт» недоступен для вашей роли" };
  }

  let orderType = String(draft?.order_type || "").trim() || null;
  if (orderType && !VOICE_ORDER_TYPES.has(orderType)) orderType = null;
  if (isUserLite() && orderType === "Магазин") {
    return { ok: false, message: "Тип «Магазин» недоступен для вашей роли" };
  }
  if (isUserShop()) {
    orderType = "Магазин";
  }

  let phone = normalizeOrderPhone(draft?.phone);
  if (phone && !isValidOrderPhone(phone)) {
    return { ok: false, message: "Неверный формат телефона" };
  }

  const amount = normalizeVoiceInteger(draft?.amount);
  const prepayment = normalizeVoiceInteger(draft?.prepayment);
  if (amount != null && prepayment != null && prepayment > amount) {
    return { ok: false, message: "Предоплата не может быть больше суммы заказа" };
  }

  let remainingAmount = normalizeVoiceInteger(draft?.remaining_amount);
  if (remainingAmount == null && amount != null) {
    remainingAmount = amount - (prepayment ?? 0);
  }

  const prepaymentTo = normalizeVoiceMoneyTo(draft?.prepayment_to);
  if (prepayment != null && prepayment !== 0 && !prepaymentTo) {
    return { ok: false, message: "Укажите, кому предоплата" };
  }
  if (
    isForbiddenKassaBeznalSelection(prepaymentTo, "") ||
    isForbiddenKassaBeznalSelection(normalizeVoiceMoneyTo(draft?.remaining_to), "")
  ) {
    return { ok: false, message: "«Касса» и «Безнал» доступны только ролям admin и user" };
  }

  let delivery = String(draft?.delivery || "").trim() || null;
  if (delivery && !VOICE_DELIVERY.has(delivery)) delivery = null;
  const deliveryDate = normalizeVoiceIsoDate(draft?.delivery_date);
  if (delivery && !deliveryDate) {
    return { ok: false, message: "Укажите дату отправки" };
  }

  const installation = Boolean(draft?.installation);
  const installationDate = installation ? normalizeVoiceIsoDate(draft?.installation_date) : null;

  const orderDateIso = normalizeVoiceIsoDate(draft?.order_date);
  const orderDate = orderDateIso
    ? `${orderDateIso}T${new Date().toTimeString().slice(0, 8)}`
    : new Date().toISOString();

  const remainingTo = normalizeVoiceMoneyTo(draft?.remaining_to);
  if (paymentStatus === "Заказ закрыт" && !remainingTo && remainingAmount !== 0) {
    return { ok: false, message: "Заказ нельзя закрыть, если он не оплачен" };
  }

  const orderData = {
    phone,
    client,
    order_type: orderType,
    address,
    payment_status: paymentStatus,
    order_date: orderDate,
    order_number: null,
    description: String(draft?.description || "").trim() || null,
    amount,
    prepayment,
    prepayment_to: prepaymentTo,
    remaining_amount: remainingAmount,
    remaining_to: remainingTo,
    area_m2: parseOrderFormNumber(draft?.area_m2),
    mosquito_nets: parseOrderFormNumber(draft?.mosquito_nets),
    construction_count: parseOrderFormNumber(draft?.construction_count),
    delivery,
    delivery_date: deliveryDate,
    installation,
    installation_date: installationDate,
    reveals: false,
    reveals_date: null,
    installer_name: null,
    installer_payment_amount: null,
    installer_payment_by: null,
  };

  const saveVoiceOrderOffline = () => {
    const insertPayload = insertPayloadFromFormData(orderData);
    const localId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tempId = nextOfflineTempOrderId();
    const displayRow = buildDisplayRowForPendingOrder(orderData, tempId, localId);
    addPendingOfflineOrder({ localId, displayRow, insertPayload });
    addPendingOfflineOrderHistory({
      localId:
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `hist-${Date.now()}`,
      pending_order_local_id: localId,
      order_temp_id: tempId,
      user_email: state.currentUser?.email || "",
      comment: buildOrderHistoryComment(null, orderData, false),
    });
    queueOrderDeltaCalculationsForOffline({
      orderTempId: tempId,
      wasEditing: false,
      orderData,
    });
    state.dbUnavailable = true;
    state.ordersFromCache = true;
    rebaselineAllOrdersFromStateAndPendingQueue();
    syncDbUnavailableBanner();
    return {
      ok: true,
      orderId: tempId,
      offline: true,
      message: `Заявка сохранена на устройстве (временный номер ${tempId}). Отправится в базу при появлении связи.`,
    };
  };

  if (shouldSaveNewOrderToLocalQueue()) {
    return saveVoiceOrderOffline();
  }

  let error = null;
  let savedOrderId = null;
  try {
    const result = await raceWithTimeout(supabaseClient.from("orders").insert([orderData]).select().single());
    error = result.error;
    if (!error && result.data) savedOrderId = result.data.id;
  } catch (e) {
    error = e;
  }

  if (error && shouldFallbackSaveOrderToLocal(error)) {
    applyOfflineModeFromDbUnavailable();
    return saveVoiceOrderOffline();
  }

  if (error) {
    console.error("voice create order:", error);
    return {
      ok: false,
      message: `Ошибка при сохранении заявки. ${error.message || error.hint || String(error.code || error)}`,
    };
  }

  await writeOrderDeltaCalculations({
    orderId: savedOrderId,
    wasEditing: false,
    orderData,
  });

  if (savedOrderId && state.currentUser?.email) {
    await supabaseClient.from("order_history").insert([
      {
        order_id: savedOrderId,
        user_email: state.currentUser.email,
        comment: buildOrderHistoryComment(null, orderData, false),
      },
    ]);
  }

  await loadOrders();
  return {
    ok: true,
    orderId: savedOrderId,
    message: `Заявка номер ${savedOrderId} создана.`,
  };
}

const VOICE_PATCHABLE_KEYS = [
  "client",
  "phone",
  "address",
  "description",
  "order_type",
  "payment_status",
  "order_date",
  "amount",
  "prepayment",
  "prepayment_to",
  "remaining_amount",
  "remaining_to",
  "delivery",
  "delivery_date",
  "installation",
  "installation_date",
  "area_m2",
  "mosquito_nets",
  "construction_count",
];

function findLocalOrderForVoice(orderId) {
  const idNum = Number(orderId);
  return (state.allOrders || []).find((o) => {
    if (!o || o.deleted_at != null) return false;
    return Number(o.id) === idNum || o.id === orderId;
  });
}

function buildOrderDataFromExistingAndPatch(existing, patch) {
  const amount =
    patch && "amount" in patch ? normalizeVoiceInteger(patch.amount) : normalizeVoiceInteger(existing.amount);
  const prepayment =
    patch && "prepayment" in patch
      ? normalizeVoiceInteger(patch.prepayment)
      : normalizeVoiceInteger(existing.prepayment);

  let remainingAmount;
  if (patch && "remaining_amount" in patch) {
    remainingAmount = normalizeVoiceInteger(patch.remaining_amount);
  } else if (patch && ("amount" in patch || "prepayment" in patch) && amount != null) {
    remainingAmount = amount - (prepayment ?? 0);
  } else {
    remainingAmount = normalizeVoiceInteger(existing.remaining_amount);
  }

  let paymentStatus = String(
    patch && "payment_status" in patch ? patch.payment_status : existing.payment_status || ""
  ).trim();
  let orderType = String(
    patch && "order_type" in patch ? patch.order_type ?? "" : existing.order_type || ""
  ).trim() || null;
  if (orderType && !VOICE_ORDER_TYPES.has(orderType)) orderType = existing.order_type || null;

  let delivery = String(
    patch && "delivery" in patch ? patch.delivery ?? "" : existing.delivery || ""
  ).trim() || null;
  if (delivery && !VOICE_DELIVERY.has(delivery)) delivery = existing.delivery || null;

  const deliveryDate =
    patch && "delivery_date" in patch
      ? normalizeVoiceIsoDate(patch.delivery_date)
      : normalizeVoiceIsoDate(existing.delivery_date);

  const installation =
    patch && "installation" in patch ? Boolean(patch.installation) : Boolean(existing.installation);
  const installationDate = installation
    ? patch && "installation_date" in patch
      ? normalizeVoiceIsoDate(patch.installation_date)
      : normalizeVoiceIsoDate(existing.installation_date)
    : null;

  const orderDateIso =
    patch && "order_date" in patch
      ? normalizeVoiceIsoDate(patch.order_date)
      : normalizeVoiceIsoDate(existing.order_date);
  const orderDate = orderDateIso
    ? String(existing.order_date || "").startsWith(orderDateIso)
      ? existing.order_date
      : `${orderDateIso}T${new Date().toTimeString().slice(0, 8)}`
    : existing.order_date || new Date().toISOString();

  const client = String(
    patch && "client" in patch ? patch.client ?? "" : existing.client || ""
  ).trim();
  const phoneRaw = patch && "phone" in patch ? patch.phone : existing.phone;
  const phone = normalizeOrderPhone(phoneRaw);

  const prepaymentTo =
    patch && "prepayment_to" in patch
      ? normalizeVoiceMoneyTo(patch.prepayment_to)
      : normalizeVoiceMoneyTo(existing.prepayment_to);
  const remainingTo =
    patch && "remaining_to" in patch
      ? normalizeVoiceMoneyTo(patch.remaining_to)
      : normalizeVoiceMoneyTo(existing.remaining_to);

  return {
    phone,
    client,
    order_type: orderType,
    address: String(
      patch && "address" in patch ? patch.address ?? "" : existing.address || ""
    ).trim() || null,
    payment_status: paymentStatus || null,
    order_date: orderDate,
    order_number: existing.order_number ?? null,
    description: String(
      patch && "description" in patch ? patch.description ?? "" : existing.description || ""
    ).trim() || null,
    amount,
    prepayment,
    prepayment_to: prepaymentTo,
    remaining_amount: remainingAmount,
    remaining_to: remainingTo,
    area_m2:
      patch && "area_m2" in patch
        ? parseOrderFormNumber(patch.area_m2)
        : parseOrderFormNumber(existing.area_m2),
    mosquito_nets:
      patch && "mosquito_nets" in patch
        ? parseOrderFormNumber(patch.mosquito_nets)
        : parseOrderFormNumber(existing.mosquito_nets),
    construction_count:
      patch && "construction_count" in patch
        ? parseOrderFormNumber(patch.construction_count)
        : parseOrderFormNumber(existing.construction_count),
    delivery,
    delivery_date: deliveryDate,
    installation,
    installation_date: installationDate,
    reveals: Boolean(existing.reveals),
    reveals_date: existing.reveals_date ?? null,
    installer_name: existing.installer_name ?? null,
    installer_payment_amount: normalizeVoiceInteger(existing.installer_payment_amount),
    installer_payment_by: existing.installer_payment_by ?? null,
  };
}

/**
 * Обновить заказ из голосового ассистента (патч полей, без открытия формы).
 * @param {number|string} orderId
 * @param {Record<string, unknown>} patch
 * @returns {Promise<{ ok: boolean, orderId?: number|string, message: string, offline?: boolean }>}
 */
export async function updateOrderFromVoicePayload(orderId, patch) {
  if (!canMutateOrders()) {
    return { ok: false, message: "Недостаточно прав для редактирования заказов" };
  }

  const existing = findLocalOrderForVoice(orderId);
  if (!existing) {
    return { ok: false, message: `Заказ номер ${orderId} не найден` };
  }
  if (isOrderHiddenForCurrentRole(existing)) {
    return { ok: false, message: "Нет доступа к этому типу заказа" };
  }
  if (isUserLite() && isOrderEditLockedForUserLite(existing)) {
    return { ok: false, message: "Редактирование этого заказа для вашей роли отключено" };
  }

  const cleanPatch = {};
  if (patch && typeof patch === "object") {
    for (const key of VOICE_PATCHABLE_KEYS) {
      if (!(key in patch)) continue;
      const v = patch[key];
      // Пустые client/status/address в патче = «не менять» (модель часто шлёт null по неизменённым полям).
      if (
        (key === "client" || key === "payment_status" || key === "address") &&
        (v == null || v === "")
      ) {
        continue;
      }
      cleanPatch[key] = v;
    }
  }
  if (Object.keys(cleanPatch).length === 0) {
    return { ok: false, message: "Не указано, какие поля изменить" };
  }

  const orderData = buildOrderDataFromExistingAndPatch(existing, cleanPatch);

  if (!orderData.client) {
    return { ok: false, message: "Клиент обязателен — нельзя оставить пустым" };
  }
  if (!orderData.address) {
    return { ok: false, message: "Адрес обязателен — нельзя оставить пустым" };
  }
  if (!orderData.payment_status) {
    return { ok: false, message: "Статус обязателен — нельзя оставить пустым" };
  }
  if (!VOICE_PAYMENT_STATUSES.has(orderData.payment_status)) {
    return { ok: false, message: "Неизвестный статус. Укажите один из допустимых статусов." };
  }
  if (orderData.payment_status === "Заказ закрыт" && !isAdmin() && state.currentRole !== "user") {
    return { ok: false, message: "Статус «Заказ закрыт» недоступен для вашей роли" };
  }
  if (
    isForbiddenKassaBeznalSelection(orderData.prepayment_to, existing.prepayment_to) ||
    isForbiddenKassaBeznalSelection(orderData.remaining_to, existing.remaining_to)
  ) {
    return { ok: false, message: "«Касса» и «Безнал» доступны только ролям admin и user" };
  }

  if (isUserLite() && orderData.order_type === "Магазин") {
    return { ok: false, message: "Тип «Магазин» недоступен для вашей роли" };
  }
  if (isUserShop()) {
    orderData.order_type = "Магазин";
  }

  if (orderData.phone) {
    orderData.phone = normalizeOrderPhone(orderData.phone);
    if (!isValidOrderPhone(orderData.phone)) {
      return { ok: false, message: "Неверный формат телефона" };
    }
  }

  if (
    orderData.amount != null &&
    orderData.prepayment != null &&
    orderData.prepayment > orderData.amount
  ) {
    return { ok: false, message: "Предоплата не может быть больше суммы заказа" };
  }
  if (orderData.prepayment != null && orderData.prepayment !== 0 && !orderData.prepayment_to) {
    return { ok: false, message: "Укажите, кому предоплата" };
  }
  if (orderData.delivery && !orderData.delivery_date) {
    return { ok: false, message: "Укажите дату отправки" };
  }
  if (
    orderData.payment_status === "Заказ закрыт" &&
    !orderData.remaining_to &&
    orderData.remaining_amount !== 0
  ) {
    return { ok: false, message: "Заказ нельзя закрыть, если он не оплачен" };
  }

  const prevSnapshot = cloneOrderWithoutOfflineMeta(existing);
  const historyComment = buildOrderHistoryComment(prevSnapshot, orderData, true);
  if (historyComment === "Сохранено без изменений") {
    return { ok: false, message: "Нет изменений для сохранения" };
  }

  const initialSums = {
    prepayment: existing.prepayment,
    remaining_amount: existing.remaining_amount,
    installer_payment_amount: existing.installer_payment_amount,
  };
  const initialParticipants = {
    prepayment_to: existing.prepayment_to,
    remaining_to: existing.remaining_to,
    installer_payment_by: existing.installer_payment_by,
  };

  const idNum = Number(orderId);

  if (isOfflineClientOrderId(idNum)) {
    const localId = existing.__offlineLocalId;
    if (!localId) {
      return { ok: false, message: "Не удалось обновить локальную заявку" };
    }
    const insertPayload = insertPayloadFromFormData(orderData);
    const displayRow = buildDisplayRowForPendingOrder(orderData, idNum, localId);
    updatePendingOfflineOrder(localId, displayRow, insertPayload);
    addPendingOfflineOrderHistory({
      localId:
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `hist-${Date.now()}`,
      pending_order_local_id: localId,
      order_temp_id: idNum,
      user_email: state.currentUser?.email || "",
      comment: historyComment,
    });
    queueOrderDeltaCalculationsForOffline({
      orderTempId: idNum,
      wasEditing: true,
      initialSums,
      initialParticipants,
      orderData,
    });
    state.dbUnavailable = true;
    state.ordersFromCache = true;
    rebaselineAllOrdersFromStateAndPendingQueue();
    syncDbUnavailableBanner();
    return {
      ok: true,
      orderId: idNum,
      offline: true,
      message: `Заявка номер ${idNum} обновлена на устройстве. Отправится в базу при появлении связи.`,
    };
  }

  if (isOfflineDataMode()) {
    const changedAt = new Date().toISOString();
    addOrAppendPendingServerOrderEdit({
      orderId: idNum,
      orderData,
      prevSnapshot,
      historyComment,
      user_email: state.currentUser?.email || "",
      changedAt,
      initialSums,
      initialParticipants,
    });
    queueOrderDeltaCalculationsForOffline({
      orderTempId: idNum,
      wasEditing: true,
      initialSums,
      initialParticipants,
      orderData,
    });
    state.dbUnavailable = true;
    state.ordersFromCache = true;
    rebaselineAllOrdersFromStateAndPendingQueue();
    syncDbUnavailableBanner();
    return {
      ok: true,
      orderId: idNum,
      offline: true,
      message: `Изменения заказа ${idNum} сохранены на устройстве; отправка в базу при появлении связи.`,
    };
  }

  let error = null;
  let savedOrderId = idNum;
  try {
    const result = await raceWithTimeout(
      supabaseClient.from("orders").update(orderData).eq("id", idNum).select().single()
    );
    error = result.error;
    if (!error && result.data) savedOrderId = result.data.id;
  } catch (e) {
    error = e;
  }

  if (error && shouldFallbackSaveOrderToLocal(error)) {
    applyOfflineModeFromDbUnavailable();
    const changedAt = new Date().toISOString();
    addOrAppendPendingServerOrderEdit({
      orderId: idNum,
      orderData,
      prevSnapshot,
      historyComment,
      user_email: state.currentUser?.email || "",
      changedAt,
      initialSums,
      initialParticipants,
    });
    queueOrderDeltaCalculationsForOffline({
      orderTempId: idNum,
      wasEditing: true,
      initialSums,
      initialParticipants,
      orderData,
    });
    rebaselineAllOrdersFromStateAndPendingQueue();
    syncDbUnavailableBanner();
    return {
      ok: true,
      orderId: idNum,
      offline: true,
      message: `Изменения заказа ${idNum} сохранены на устройстве; отправка в базу при появлении связи.`,
    };
  }

  if (error) {
    console.error("voice update order:", error);
    return {
      ok: false,
      message: `Ошибка при обновлении заявки. ${error.message || error.hint || String(error.code || error)}`,
    };
  }

  await writeOrderDeltaCalculations({
    orderId: savedOrderId,
    wasEditing: true,
    initialSums,
    initialParticipants,
    orderData,
  });

  if (savedOrderId && state.currentUser?.email) {
    await supabaseClient.from("order_history").insert([
      {
        order_id: savedOrderId,
        user_email: state.currentUser.email,
        comment: historyComment,
      },
    ]);
  }

  await loadOrders();
  return {
    ok: true,
    orderId: savedOrderId,
    message: `Заявка номер ${savedOrderId} обновлена.`,
  };
}