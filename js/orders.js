import { supabaseClient } from "./config.js";
import { checkDatabaseAvailable, setDbUnavailableBannerVisible } from "./dbHealth.js";
import { state } from "./state.js";
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
} from "./section-nav.js";
import {
  loadFilesCountMap,
  getFilesWord,
  uploadFiles,
  resetFileUpload,
  clearExistingOrderFilesInForm,
  renderExistingOrderFilesInForm,
} from "./files.js";
import { formatAmount, formatOrderIdTypeChip } from "./format.js";
import { applyOrdersTableMobileFit } from "./ordersTableMobileFit.js";
import {
  canMutateOrders,
  isAdmin,
  isOrderEditLockedForUserLite,
  isOrderHiddenFromUserLite,
  isUserLite,
} from "./roles.js";

export async function loadOrders() {
  if (!(await checkDatabaseAvailable())) {
    setDbUnavailableBannerVisible(true);
    state.allOrders = [];
    state.filesCountMap = {};
    applyFiltersAndRender();
    updateSectionNavRicherStat();
    if (getCurrentSectionId() === "tasks-all") {
      refreshSectionNavLabel();
      void import("./tasks.js").then((m) => m.loadAllTasks());
    } else if (getCurrentSectionId() === "order-tasks") {
      refreshSectionNavLabel();
      void import("./tasks.js").then((m) => m.loadOrderTasks());
    }
    setMessage("Ошибка загрузки заявок", "#d32f2f");
    return;
  }

  const { data, error } = await supabaseClient
    .from("orders")
    .select("*")
    .is("deleted_at", null)
    .order("id", { ascending: false });

  if (error) {
    console.error("Ошибка загрузки:", error);
    setDbUnavailableBannerVisible(true);
    setMessage("Ошибка загрузки заявок", "#d32f2f");
    return;
  }

  setDbUnavailableBannerVisible(false);
  state.allOrders = data || [];
  await loadFilesCountMap();
  applyFiltersAndRender();
  updateSectionNavRicherStat();
  if (getCurrentSectionId() === "tasks-all") {
    refreshSectionNavLabel();
    void import("./tasks.js").then((m) => m.loadAllTasks());
  } else if (getCurrentSectionId() === "order-tasks") {
    refreshSectionNavLabel();
    void import("./tasks.js").then((m) => m.loadOrderTasks());
  }
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

function normalizeStatus(val) {
  if (val === "нет" || val === "оплачен" || val == null || val === "") return "Контакт с клиентом";
  return val;
}

/** Ключи фильтра у колонки «Номер» (тип заказа); __empty__ — без типа */
const ORDER_TYPE_FILTER_KEYS = ["__empty__", "Окна", "Подоконники", "Аллюминий", "Магазин", "Сетки/мелочь"];

function orderTypeFilterKeysForUi() {
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
  amount: 2,
  prepayment: 2,
  remaining_amount: 2,
  area_m2: 2,
  mosquito_nets: 0,
  construction_count: 0,
  installer_rate_per_m2: 2,
  installer_payment_amount: 2,
};

const ORDER_DELTA_CALC_COMMENT_PREFIX = "[AUTO_ORDER_DELTA]";

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

function shortLoginByEmail(email) {
  const raw = String(email || "").trim();
  if (!raw) return "неизв..";
  const login = raw.split("@")[0] || raw;
  return `${login.slice(0, 5)}..`;
}

async function writeOrderDeltaCalculations({
  orderId,
  wasEditing,
  initialSums,
  initialParticipants,
  orderData,
}) {
  if (!orderId) return;

  const nowIso = new Date().toISOString();
  const timeHHmm = formatTimeHHmmFromIso(nowIso);
  const actorShort = shortLoginByEmail(state.currentUser?.email);
  const orderNumberStr = formatOrderIdTypeChip(orderId, orderData?.order_type) || `#${orderId}`;
  const clientStr = (orderData?.client && String(orderData.client).trim()) || "—";
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
  const pushRow = ({ key, kindLabel, from_place, to_place, oldVal, newVal }) => {
    const delta = newVal - oldVal;
    if (Math.abs(delta) < 0.000001) return;
    rows.push({
      created_at: nowIso,
      from_place: from_place || "—",
      to_place: to_place || "—",
      amount: delta,
      comment: `${ORDER_DELTA_CALC_COMMENT_PREFIX} ${kindLabel}; ${orderNumberStr}; ${clientStr}; ${formatAmount(oldVal)} → ${formatAmount(newVal)}; ${timeHHmm}; ${actorShort}`,
      order_id: orderId,
      delta_key: key,
    });
  };

  pushRow({
    key: "prepayment",
    kindLabel: "Предоплата",
    from_place: "Клиент",
    to_place: orderData?.prepayment_to || (wasEditing ? initialParticipants?.prepayment_to : "") || "—",
    oldVal: old.prepayment,
    newVal: next.prepayment,
  });

  const remainingToBefore = (wasEditing ? initialParticipants?.remaining_to : "") || "";
  const remainingToAfter = orderData?.remaining_to || "";
  const remainingToMissingBoth = !remainingToBefore.trim() && !remainingToAfter.trim();
  if (!remainingToMissingBoth) {
    pushRow({
      key: "remaining_amount",
      kindLabel: "Остаток",
      from_place: "Клиент",
      to_place: remainingToAfter || remainingToBefore || "—",
      oldVal: old.remaining_amount,
      newVal: next.remaining_amount,
    });
  }

  const installerByBefore = (wasEditing ? initialParticipants?.installer_payment_by : "") || "";
  const installerByAfter = orderData?.installer_payment_by || "";
  const installerByMissingBoth = !installerByBefore.trim() && !installerByAfter.trim();
  if (!installerByMissingBoth) {
    pushRow({
      key: "installer_payment_amount",
      kindLabel: "Монтаж",
      from_place: installerByAfter || installerByBefore || "—",
      to_place: "Монтаж",
      oldVal: old.installer_payment_amount,
      newVal: next.installer_payment_amount,
    });
  }

  if (rows.length === 0) return;

  const payload = rows.map((r) => ({
    created_at: r.created_at,
    from_place: r.from_place,
    to_place: r.to_place,
    amount: r.amount,
    comment: r.comment,
  }));
  const { error } = await supabaseClient.from("calculations").insert(payload);
  if (error) {
    console.error("Автозапись дельт в calculations:", error);
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

function getFilteredOrders() {
  let list = state.allOrders;

  if (isUserLite()) {
    list = list.filter((order) => !isOrderHiddenFromUserLite(order));
  }

  if (state.statusFilterSelected && state.statusFilterSelected.length > 0) {
    list = list.filter((order) => {
      const norm = normalizeStatus(order.payment_status);
      return state.statusFilterSelected.includes(norm);
    });
  }

  if (state.orderTypeFilterSelected && state.orderTypeFilterSelected.length > 0) {
    list = list.filter((order) => orderMatchesOrderTypeKeys(order, state.orderTypeFilterSelected));
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

  return list;
}

export function applyFiltersAndRender() {
  renderOrders(getFilteredOrders());
  // Сигнал UI-коду: фильтры (статусы/типы) изменились и таблица перерисована.
  // Это нужно, чтобы синхронизировать внешние быстрые переключатели.
  document.dispatchEvent(new CustomEvent("orders-filters-updated"));
}

function escapeHtml(s) {
  if (s == null || s === "") return "";
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
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

function formatDateShortRU(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return "";
    const months = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
    return `${d.getDate()} ${months[d.getMonth()]}`;
  } catch {
    return "";
  }
}

/** Оплачено = "да", если заполнено "Кому остаток" ИЛИ Остаток = 0. */
function isOrderPaid(order) {
  const remainingToRaw = (order.remaining_to || "").trim();
  const paidByRemainingTo = remainingToRaw !== "" && remainingToRaw !== "—";

  const remainingAmount = parseOrderFormNumber(order.remaining_amount);
  const paidByRemainingAmountZero = remainingAmount != null && Math.abs(remainingAmount) < 1e-9;

  return paidByRemainingTo || paidByRemainingAmountZero;
}

function isRemainingAmountZero(order) {
  const remainingAmount = parseOrderFormNumber(order.remaining_amount);
  return remainingAmount != null && Math.abs(remainingAmount) < 1e-9;
}

/** Кнопка «Редактировать» в таблице и в меню по номеру. */
export function canShowEditButtonForOrder(order) {
  if (!canMutateOrders()) return false;
  if (isUserLite() && isOrderEditLockedForUserLite(order)) return false;
  return true;
}

export async function setLockEditForUserLite(orderId, locked) {
  if (isUserLite()) return false;
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

export function renderOrders(orders) {
  document.dispatchEvent(new CustomEvent("orders-table-will-render"));
  const table = document.querySelector("#ordersTable tbody");
  table.innerHTML = "";

  orders.forEach((order) => {
    const deleteButton =
      isAdmin()
        ? `<button type="button" class="btn-icon btn-delete" onclick="deleteOrder(${order.id})" title="Удалить"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>`
        : "";

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
    const statusDisplayText =
      order.payment_status === "нет" ? "Контакт с клиентом" : (order.payment_status ?? "Контакт с клиентом");
    const row = `
      <tr>
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
        <td class="td-installation-date">${formatDateShortRU(order.installation_date)}</td>
        <td class="td-area-m2">${order.area_m2 != null && order.area_m2 !== "" ? escapeHtml(String(order.area_m2)) : ""}</td>
        <td class="td-money td-installer-payment">${
          order.installer_payment_amount != null && order.installer_payment_amount !== ""
            ? order.installer_payment_by
              ? `<span class="installer-paid-value">${formatAmount(order.installer_payment_amount)}</span>`
              : `<span class="status-value">${formatAmount(order.installer_payment_amount)}</span>`
            : ""
        }</td>
        <td>${order.installer_payment_by ? escapeHtml(order.installer_payment_by) : ""}</td>
        <td>${formatDateShortRU(order.reveals_date)}</td>
        <td class="td-mosquito-nets">${order.mosquito_nets != null && order.mosquito_nets !== "" ? escapeHtml(String(order.mosquito_nets)) : ""}</td>
        <td class="td-construction-count">${order.construction_count != null && order.construction_count !== "" ? escapeHtml(String(order.construction_count)) : ""}</td>
        <td class="td-phone">${phone ? escapeHtml(phone) : ""}</td>
        <td class="td-actions td-delete">${deleteButton}</td>
      </tr>
    `;

    table.innerHTML += row;
  });

  table.querySelectorAll(".td-order-client, .td-order-address, .td-order-description, .td-order-status").forEach((cell) => {
    const full = cell.getAttribute("data-fulltext");
    if (!full) return;
    const chip = cell.querySelector(".status-value");
    const truncated = chip ? chip.scrollWidth > chip.clientWidth + 0.5 : cell.scrollWidth > cell.clientWidth + 0.5;
    if (truncated) cell.setAttribute("title", full);
    else cell.removeAttribute("title");
  });

  // Синхронизация горизонтальной прокрутки: сверху и снизу
  ensureOrdersScrollSync();
  updateOrdersScrollSpacerWidth();
  syncOrdersScrollPositions();
  applyOrdersTableMobileFit();
  syncOrdersTableOuterWidthForTouch();
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

let tableFilterDocClickBound = false;

function bindTableFilterDocClose() {
  if (tableFilterDocClickBound) return;
  tableFilterDocClickBound = true;
  document.addEventListener("click", () => {
    closeStatusFilterDropdown();
    closeOrderTypeFilterDropdown();
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
      renderStatusFilterDropdown();
      const rect = getFilterDropdownAnchorRect(
        btn,
        "#ordersTableStickyHeadTable thead button.status-filter-btn:not(.order-type-filter-btn)"
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

export function getFormData() {
  const orderNumberEl = document.getElementById("order_number");
  return {
    phone: document.getElementById("phone").value.trim() || null,
    client: document.getElementById("client").value.trim() || null,
    order_type: document.getElementById("order_type")?.value.trim() || null,
    address: document.getElementById("address").value.trim() || null,
    payment_status: document.getElementById("payment_status").value.trim() || null,
    order_date: syncOrderFormDateTimeFromDom(),
    order_number: orderNumberEl ? (orderNumberEl.value.trim() || null) : null,
    description: document.getElementById("description").value.trim() || null,
    amount: parseOrderFormNumber(document.getElementById("amount").value),
    prepayment: parseOrderFormNumber(document.getElementById("prepayment").value),
    prepayment_to: document.getElementById("prepayment_to").value.trim() || null,
    remaining_amount: parseOrderFormNumber(document.getElementById("remaining_amount").value),
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
    installer_payment_amount: parseOrderFormNumber(document.getElementById("installer_payment_amount")?.value),
    installer_payment_by: document.getElementById("installer_payment_by")?.value?.trim() || null,
  };
}

/** Автозаполнение Остаток = Стоимость - Предоплата, если Стоимость заполнена */
export function updateRemainingFromCostAndPrepayment() {
  const amountEl = document.getElementById("amount");
  const prepaymentEl = document.getElementById("prepayment");
  const remainingEl = document.getElementById("remaining_amount");
  if (!amountEl || !prepaymentEl || !remainingEl) return;
  const amount = parseOrderFormNumber(amountEl.value);
  if (amount == null) return;
  const prepayment = parseOrderFormNumber(prepaymentEl.value) ?? 0;
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

  const remainingAmount = remainingAmountEl ? parseOrderFormNumber(remainingAmountEl.value) : null;
  const remainingAmountZero = remainingAmount != null && Math.abs(remainingAmount) < 1e-9;

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
    rateEl: document.getElementById("installer_rate_per_m2"),
    calcBtn: document.getElementById("installer_calc_btn"),
  };
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
  const { block, amountEl, byEl, rateEl, calcBtn } = getInstallerPaymentElements();
  if (!block) return;
  block.classList.toggle(INSTALLER_BLOCK_INACTIVE_CLASS, !hasDate);
  if (rateEl) rateEl.disabled = !hasDate;
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
  const rate = parseOrderFormNumber(rateEl?.value);

  if (area != null && rate != null && area > 0 && rate > 0) {
    amountEl.value = formatOrderFormNumberValue(
      area * rate,
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

export function fillForm(order) {
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
  checkInstallerPaymentDone(order.id);
}

export function resetFormMode() {
  state.editingOrderId = null;
  state.editingOrderDescription = null;
  state.initialPaymentStatus = null;
  state.initialOrderSums = null;
  state.initialOrderParticipants = null;
  state.installerPaymentDone = false;
  document.getElementById("orderForm").reset();
  updatePaidField();
  updateConditionalRequiredHighlight();
  const inst = getInstallerPaymentElements();
  if (inst.amountEl) inst.amountEl.value = "";
  if (inst.byEl) inst.byEl.value = "";
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

  if (formTitle) {
    formTitle.textContent = "Новая заявка";
  }

  if (cancelEditBtn) cancelEditBtn.style.display = "inline-block";
  if (cancelEditBtnTop) cancelEditBtnTop.style.display = "inline-block";
}

export async function editOrder(orderId) {
  if (!canMutateOrders()) {
    setMessage("Недостаточно прав для редактирования заявок", "#d32f2f");
    return;
  }

  const { data, error } = await supabaseClient
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (error) {
    console.error("Ошибка загрузки заявки:", error);
    setMessage("Ошибка загрузки заявки", "#d32f2f");
    return;
  }

  if (isOrderHiddenFromUserLite(data)) {
    setMessage("Нет доступа к заказам типа «Магазин»", "#d32f2f");
    return;
  }

  if (isUserLite() && isOrderEditLockedForUserLite(data)) {
    setMessage("Редактирование этого заказа для вашей роли отключено", "#d32f2f");
    return;
  }

  state.editingOrderId = orderId;
  state.editingOrderDescription = data.description || null;
  fillForm(data);
  setMessage("", "");

  if (submitBtn) submitBtn.textContent = "Сохранить изменения";
  if (submitBtnTop) submitBtnTop.textContent = "Сохранить изменения";

  if (formTitle) {
    formTitle.textContent = `Редактирование ${formatOrderIdTypeChip(orderId, data.order_type)}`;
  }

  if (cancelEditBtn) cancelEditBtn.style.display = "inline-block";
  if (cancelEditBtnTop) cancelEditBtnTop.style.display = "inline-block";

  switchSection("new");

  window.scrollTo({ top: 0, behavior: "smooth" });
}

export async function deleteOrder(orderId) {
  if (!isAdmin()) return;

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

  setMessage(`Заявка #${orderId} удалена`, "");
  await loadOrders();
}

export async function submitOrderForm(event) {
  event.preventDefault();
  setOrderFormInvalidDateMessage(false);

  if (!canMutateOrders()) {
    setMessage("Недостаточно прав для сохранения заявок", "#d32f2f");
    return;
  }

  const orderTypeForSave = (document.getElementById("order_type")?.value || "").trim();
  if (isUserLite() && orderTypeForSave === "Магазин") {
    setMessage("Тип заказа «Магазин» недоступен для вашей роли", "#d32f2f");
    return;
  }

  if (state.editingOrderId && isUserLite()) {
    const { data: lockRow, error: lockErr } = await supabaseClient
      .from("orders")
      .select("lock_edit_for_user_lite")
      .eq("id", state.editingOrderId)
      .single();
    if (!lockErr && lockRow && isOrderEditLockedForUserLite(lockRow)) {
      setMessage("Редактирование этого заказа для вашей роли отключено", "#d32f2f");
      return;
    }
  }

  const phoneVal = (document.getElementById("phone")?.value || "").trim();
  const clientVal = (document.getElementById("client")?.value || "").trim();

  if (!clientVal) {
    setMessage("Не заполнено Клиент", "#d32f2f");
    document.getElementById("client")?.classList.add("client-invalid");
    return;
  }
  document.getElementById("client")?.classList.remove("client-invalid");

  const statusVal = (document.getElementById("payment_status")?.value || "").trim();
  if (!statusVal) {
    setMessage("Не заполнено Статус", "#d32f2f");
    document.getElementById("payment_status")?.classList.add("payment-status-invalid");
    return;
  }
  document.getElementById("payment_status")?.classList.remove("payment-status-invalid");

  // Правило: нельзя ставить "Заказ закрыт", если "Оплачено" = "нет"
  // "Оплачено" вычисляется от поля "Кому остаток" через updatePaidField().
  updatePaidField();
  const paidVal = document.getElementById("paid")?.value;
  if (statusVal === "Заказ закрыт" && paidVal === "нет") {
    setMessage("Заказ нельзя закрыть, если он не оплачен", "#d32f2f");
    return;
  }

  if (phoneVal) {
    const phoneDigits = phoneVal.replace(/\D/g, "");
    const phoneValid = phoneDigits.length === 11 && (phoneDigits[0] === "8" || phoneDigits[0] === "7");
    if (!phoneValid) {
      setMessage("Неверный формат телефона.", "#d32f2f");
      document.getElementById("phone")?.classList.add("phone-invalid");
      return;
    }
  }

  if (hasInvalidOrderFormDateInput()) {
    updateOrderFormDateFieldHighlights(true);
    setOrderFormInvalidDateMessage(true);
    return;
  }

  const prepaymentVal = (document.getElementById("prepayment")?.value || "").trim();
  const prepaymentToVal = (document.getElementById("prepayment_to")?.value || "").trim();
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

  // Правило: Предоплата не может быть больше стоимости.
  const amountNum = parseOrderFormNumber(document.getElementById("amount")?.value);
  const prepaymentNum = parseOrderFormNumber(document.getElementById("prepayment")?.value);
  if (amountNum != null && prepaymentNum != null && prepaymentNum > amountNum) {
    setMessage("Предоплата не может быть больше суммы заказа", "#d32f2f");
    return;
  }

  setMessage("Сохраняю...", "");

  const orderData = getFormData();

  let error = null;
  let savedOrderId = state.editingOrderId;
  const wasEditing = Boolean(state.editingOrderId);

  if (state.editingOrderId) {
    const result = await supabaseClient
      .from("orders")
      .update(orderData)
      .eq("id", state.editingOrderId)
      .select()
      .single();

    error = result.error;

    if (!error && result.data) {
      savedOrderId = result.data.id;
    }
  } else {
    const result = await supabaseClient
      .from("orders")
      .insert([orderData])
      .select()
      .single();

    error = result.error;

    if (!error && result.data) {
      savedOrderId = result.data.id;
    }
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

  const addCommentText = (document.getElementById("description")?.value || "").trim();
  const newStatus = orderData.payment_status || "";

  if (!wasEditing && savedOrderId && state.currentUser?.email) {
    const historyRows = [
      { order_id: savedOrderId, user_email: state.currentUser.email, comment: "Заказ создан" },
      { order_id: savedOrderId, user_email: state.currentUser.email, comment: `Статус: ${newStatus || "Контакт с клиентом"}` },
    ];
    if (addCommentText) {
      historyRows.push({ order_id: savedOrderId, user_email: state.currentUser.email, comment: addCommentText });
    }
    await supabaseClient.from("order_history").insert(historyRows);
  }

  if (wasEditing && savedOrderId && state.currentUser?.email) {
    const historyRows = [];
    const oldStatus = state.initialPaymentStatus ?? "";
    if (oldStatus !== newStatus) {
      historyRows.push({
        order_id: savedOrderId,
        user_email: state.currentUser.email,
        comment: `Статус изменён: ${oldStatus || "—"} → ${newStatus || "—"}`,
      });
    }

    // История изменений сумм
    const initialSums = state.initialOrderSums || {};
    const toComparable = (v) => (v == null ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
    const numbersEqual = (a, b) => {
      if (a == null && b == null) return true;
      if (a == null || b == null) return false;
      return Math.abs(a - b) < 0.000001;
    };
    const formatSum = (v) => (v == null ? "—" : formatAmount(v));

    const sumChanges = [];
    const fieldsToCheck = [
      { key: "amount", label: "Стоимость", oldVal: initialSums.amount, newVal: orderData.amount },
      { key: "prepayment", label: "Предоплата", oldVal: initialSums.prepayment, newVal: orderData.prepayment },
      { key: "remaining_amount", label: "Остаток", oldVal: initialSums.remaining_amount, newVal: orderData.remaining_amount },
      { key: "installer_payment_amount", label: "з/п монтаж", oldVal: initialSums.installer_payment_amount, newVal: orderData.installer_payment_amount },
    ];

    fieldsToCheck.forEach((f) => {
      const oldN = toComparable(f.oldVal);
      const newN = toComparable(f.newVal);
      if (!numbersEqual(oldN, newN)) {
        sumChanges.push(`${f.label}: ${formatSum(oldN)} → ${formatSum(newN)}`);
      }
    });

    if (sumChanges.length > 0) {
      historyRows.push({
        order_id: savedOrderId,
        user_email: state.currentUser.email,
        comment: sumChanges.join("; "),
      });
    }

    if (addCommentText) {
      historyRows.push({ order_id: savedOrderId, user_email: state.currentUser.email, comment: addCommentText });
    }
    if (historyRows.length > 0) {
      await supabaseClient.from("order_history").insert(historyRows);
    }
  }

  resetFormMode();
  // Сначала показать «Заказы»: при скрытом #section-all scrollWidth таблицы = 0,
  // и верхняя горизонтальная полоса прокрутки теряет ширину.
  switchSection("all");
  await loadOrders();
  // После перерисовки таблицы подсветить сохранённый заказ
  // и сфокусировать экран на левую часть строки.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => highlightAndFocusSavedOrderRow(savedOrderId));
  });

  setMessage(
    wasEditing
    ? `Заявка #${savedOrderId} обновлена`
    : `Заявка #${savedOrderId} сохранена`,
    ""
  );
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

/** Скрыть в форме тип «Магазин» для роли user_lite и обновить фильтр по типам. */
export function applyOrderTypeSelectForRole() {
  const sel = document.getElementById("order_type");
  if (!sel) return;
  for (const opt of sel.querySelectorAll("option")) {
    if (opt.value === "Магазин") {
      opt.hidden = isUserLite();
    }
  }
  if (isUserLite() && state.orderTypeFilterSelected?.length) {
    state.orderTypeFilterSelected = state.orderTypeFilterSelected.filter((k) => k !== "Магазин");
  }
  renderOrderTypeFilterDropdown();
  applyFiltersAndRender();
}