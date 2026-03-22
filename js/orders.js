import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import {
  clientSearch,
  setMessage,
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
import { refreshOrdersTableStickyHeader } from "./ordersTableStickyHeader.js";
import {
  canMutateOrders,
  isAdmin,
  isOrderEditLockedForUserLite,
  isOrderHiddenFromUserLite,
  isUserLite,
} from "./roles.js";

export async function loadOrders() {
  const { data, error } = await supabaseClient
    .from("orders")
    .select("*")
    .is("deleted_at", null)
    .order("id", { ascending: false });

  if (error) {
    console.error("Ошибка загрузки:", error);
    setMessage("Ошибка загрузки заявок", "#d32f2f");
    return;
  }

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

/** В полях даты формы заказа год по маске 20** — 2000–2099 (ровно 4 цифры, префикс «20»). */
const ORDER_FORM_DATE_YEAR_MIN = 2000;
const ORDER_FORM_DATE_YEAR_MAX = 2099;

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
 * Читает value поля даты и подгоняет год к 2000–2099; при необходимости обновляет input.
 * Вызывать при сохранении формы — подстраховка (в т.ч. Яндекс.Браузер: иногда нет «change»).
 */
export function syncOrderFormDateFieldFromDom(id, type) {
  const el = document.getElementById(id);
  if (!el) return null;
  const v = (el.value || "").trim();
  if (!v) return null;
  const next = normalizeOrderFormDateInputValue(v, type);
  if (next !== v) el.value = next;
  return next;
}

/** Вешает правило года (маска 20**, 2000–2099) на поля даты формы «Новый / Редактирование». */
export function bindOrderFormDateYear20xxInputs() {
  const specs = [
    { id: "order_date", type: "datetime-local" },
    { id: "delivery_date", type: "date" },
    { id: "installation_date", type: "date" },
    { id: "reveals_date", type: "date" },
  ];

  for (const { id, type } of specs) {
    const el = document.getElementById(id);
    if (!el) continue;

    // Не вешать «change» на подгонку года: в Яндекс.Браузере и др. при наборе года по цифрам
    // «change» срабатывает на промежуточных полных датах → ломается ввод, пока не ушли с поля (blur).
    const tryFix = () => {
      const v = el.value;
      if (!v) return;
      const next = normalizeOrderFormDateInputValue(v, type);
      if (next !== v) el.value = next;
    };

    el.addEventListener("focus", () => {
      el.dataset.orderFormDateSnapshot = el.value || "";
    });
    // Подгонка только после ухода с поля; выбор из календаря тоже обычно заканчивается blur.
    // rAF: значение иногда обновляется чуть позже события blur.
    el.addEventListener("blur", () => {
      const snap = el.dataset.orderFormDateSnapshot ?? "";
      requestAnimationFrame(() => {
        const v = el.value || "";
        if (v !== snap) tryFix();
      });
    });
  }
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
    },
    { passive: true }
  );

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

/** Оплачено в таблице только по полю "Кому остаток", без проверки суммы. */
function isOrderPaid(order) {
  const raw = (order.remaining_to || "").trim();
  return raw !== "" && raw !== "—";
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

function paidBadge(order) {
  if (order.amount == null || order.amount === "") return "";
  const paid = isOrderPaid(order);
  const status = order.payment_status || "";
  if (paid) return '<span class="status-paid">да</span>';
  if (status === "Производство" || status === "Товар передан заказчику" || status === "Монтаж выполнен") return '<span class="paid-no-alert">нет</span>';
  return '<span class="status-value">нет</span>';
}

export function renderOrders(orders) {
  document.dispatchEvent(new CustomEvent("orders-table-will-render"));
  const table = document.querySelector("#ordersTable tbody");
  table.innerHTML = "";

  orders.forEach((order) => {
    const historyIcon = `<a href="history.html?order_id=${order.id}" class="btn-icon btn-history" title="История"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></a>`;

    const deleteButton =
      isAdmin()
        ? `<button type="button" class="btn-icon btn-delete" onclick="deleteOrder(${order.id})" title="Удалить"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>`
        : "";

    const editIcon = canShowEditButtonForOrder(order)
      ? `<button type="button" class="btn-icon btn-edit" onclick="editOrder(${order.id})" title="Редактировать"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`
      : "";

    const filesCount = state.filesCountMap[order.id] || 0;

    const filesIcon = filesCount > 0
      ? `<button type="button" class="btn-icon btn-files" onclick="openFilesModal(${order.id})" title="Файлы: ${filesCount}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg><span class="btn-files-count">${filesCount}</span></button>`
      : "";

    const phone = order.phone ?? "";
    const telHref = phone ? "tel:" + phone.replace(/[^\d+]/g, "") : "";
    const client = order.client ?? "";
    const address = order.address ?? "";
    const description = order.description ?? "";
    const clientCell = client ? `<span class="status-value">${escapeHtml(client)}</span>` : "";
    const phoneCallIcon = phone
      ? `<a href="${escapeAttr(telHref)}" class="btn-icon btn-phone-call" title="Позвонить"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg></a>`
      : "";
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
    const row = `
      <tr>
        <td class="td-order-id" data-order-id="${order.id ?? ""}" data-phone="${escapeAttr(phone)}" data-files-count="${filesCount}" data-lock-edit-user-lite="${isOrderEditLockedForUserLite(order) ? "1" : "0"}">
          <span class="${orderIdChipClasses.join(" ")}">
            ${orderNumberDisplay}
          </span>
        </td>
        <td class="td-order-date">${formatDateShortRU(order.order_date)}</td>
        <td class="td-truncate-name" data-fulltext="${escapeAttr(client)}">${clientCell}</td>
        <td class="td-paid">${paidBadge(order)}</td>
        <td class="td-truncate-address" data-fulltext="${escapeAttr(address)}">${escapeHtml(address)}</td>
        <td class="td-truncate-description" data-fulltext="${escapeAttr(description)}">${escapeHtml(description)}</td>
        <td>
          <span class="status-value">
            ${order.payment_status === "нет" ? "Контакт с клиентом" : (order.payment_status ?? "Контакт с клиентом")}
          </span>
        </td>
        <td class="td-money td-main-amount">${order.amount != null && order.amount !== "" ? `<span class="status-value">${formatAmount(order.amount)}</span>` : ""}</td>
        <td class="td-prepayment td-money">${order.prepayment != null && order.prepayment !== "" ? `<span class="status-value">${formatAmount(order.prepayment)}</span>` : ""}</td>
        <td class="td-prepayment-to">${order.prepayment_to ? escapeHtml(order.prepayment_to) : ""}</td>
        <td class="td-remaining td-money">${order.remaining_amount != null && order.remaining_amount !== "" ? `<span class="status-value">${formatAmount(order.remaining_amount)}</span>` : ""}</td>
        <td class="td-remaining-to">${order.remaining_to ? escapeHtml(order.remaining_to) : ""}</td>
        <td class="td-delivery">${order.delivery ? escapeHtml(order.delivery) : ""}</td>
        <td class="td-delivery-date">${formatDateShortRU(order.delivery_date)}</td>
        <td class="td-installation-date">${formatDateShortRU(order.installation_date)}</td>
        <td class="td-area-m2">${order.area_m2 != null && order.area_m2 !== "" ? escapeHtml(String(order.area_m2)) : ""}</td>
        <td class="td-money">${order.installer_payment_by && order.installer_payment_amount != null && order.installer_payment_amount !== "" ? `<span class="installer-paid-value">${formatAmount(order.installer_payment_amount)}</span>` : (order.installer_payment_amount != null && order.installer_payment_amount !== "" ? formatAmount(order.installer_payment_amount) : "")}</td>
        <td>${order.installer_payment_by ? escapeHtml(order.installer_payment_by) : ""}</td>
        <td>${formatDateShortRU(order.reveals_date)}</td>
        <td class="td-mosquito-nets">${order.mosquito_nets != null && order.mosquito_nets !== "" ? escapeHtml(String(order.mosquito_nets)) : ""}</td>
        <td class="td-construction-count">${order.construction_count != null && order.construction_count !== "" ? escapeHtml(String(order.construction_count)) : ""}</td>
        <td class="td-actions td-phone-call">${phoneCallIcon}</td>
        <td class="td-phone">${phone ? escapeHtml(phone) : ""}</td>
        <td class="td-actions td-edit">${editIcon}</td>
        <td class="td-actions td-history">${historyIcon}</td>
        <td class="td-actions td-delete">${deleteButton}</td>
        <td class="td-actions td-files">${filesIcon}</td>
      </tr>
    `;

    table.innerHTML += row;
  });

  table.querySelectorAll(".td-truncate-name, .td-truncate-address, .td-truncate-description").forEach((cell) => {
    const full = cell.getAttribute("data-fulltext");
    if (!full) return;
    let truncated = false;
    if (cell.classList.contains("td-truncate-name")) {
      const chip = cell.querySelector(".status-value");
      truncated = chip ? chip.scrollWidth > chip.clientWidth + 0.5 : cell.scrollWidth > cell.clientWidth;
    } else {
      truncated = cell.scrollWidth > cell.clientWidth + 0.5;
    }
    if (truncated) cell.setAttribute("title", full);
    else cell.removeAttribute("title");
  });

  // Синхронизация горизонтальной прокрутки: сверху и снизу
  ensureOrdersScrollSync();
  updateOrdersScrollSpacerWidth();
  syncOrdersScrollPositions();
  refreshOrdersTableStickyHeader();
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
    order_date: syncOrderFormDateFieldFromDom("order_date", "datetime-local"),
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

/** Оплачено = "да" только если заполнено "Кому остаток" (select). Правило по сумме не используется. */
export function updatePaidField() {
  const remainingToEl = document.getElementById("remaining_to");
  const paidEl = document.getElementById("paid");
  if (!paidEl || !remainingToEl || remainingToEl.tagName !== "SELECT") return;
  const raw = (remainingToEl.value || "").trim();
  const remainingToFilled = raw !== "" && raw !== "—";
  paidEl.value = remainingToFilled ? "да" : "нет";
}

export function updateConditionalRequiredHighlight() {
  const prepaymentVal = (document.getElementById("prepayment")?.value || "").trim();
  const prepaymentToVal = (document.getElementById("prepayment_to")?.value || "").trim();
  const deliveryVal = (document.getElementById("delivery")?.value || "").trim();
  const deliveryDateVal = (document.getElementById("delivery_date")?.value || "").trim();
  const prepaymentToEl = document.getElementById("prepayment_to");
  const deliveryDateEl = document.getElementById("delivery_date");
  if (prepaymentToEl) prepaymentToEl.classList.toggle("conditional-invalid", !!prepaymentVal && !prepaymentToVal);
  if (deliveryDateEl) deliveryDateEl.classList.toggle("conditional-invalid", !!deliveryVal && !deliveryDateVal);
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
  const hasDate = !!(installationDateInput && installationDateInput.value && installationDateInput.value.trim());
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
  document.getElementById("order_date").value = orderDateVal.includes("T") ? orderDateVal.slice(0, 16) : (orderDateVal ? orderDateVal + "T00:00" : "");
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
  document.getElementById("delivery_date").value = order.delivery_date || "";
  const installationCb = document.getElementById("installation");
  const installationDateWrap = document.getElementById("installationDateWrap");
  const installationDateInput = document.getElementById("installation_date");
  if (installationCb) installationCb.checked = !!order.installation;
  if (installationDateWrap) installationDateWrap.style.display = order.installation ? "" : "none";
  if (installationDateInput) installationDateInput.value = order.installation_date || "";
  updateInstallerBlockByInstallationDate();
  const revealsCb = document.getElementById("reveals");
  const revealsDateWrap = document.getElementById("revealsDateWrap");
  const revealsDateInput = document.getElementById("reveals_date");
  if (revealsCb) revealsCb.checked = !!order.reveals;
  if (revealsDateWrap) revealsDateWrap.style.display = order.reveals ? "" : "none";
  if (revealsDateInput) revealsDateInput.value = order.reveals_date || "";

  updatePaidField();
  updateConditionalRequiredHighlight();
  resetFileUpload();
  void renderExistingOrderFilesInForm(order.id).catch((err) => {
    console.error("Список файлов заявки:", err);
    clearExistingOrderFilesInForm();
  });
  checkInstallerPaymentDone(order.id);
}

function getNowForDateTimeLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function resetFormMode() {
  state.editingOrderId = null;
  state.editingOrderDescription = null;
  state.initialPaymentStatus = null;
  state.initialOrderSums = null;
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
  if (orderDateInput) orderDateInput.value = getNowForDateTimeLocal();
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

  const prepaymentVal = (document.getElementById("prepayment")?.value || "").trim();
  const prepaymentToVal = (document.getElementById("prepayment_to")?.value || "").trim();
  const conditionalMissing = [];
  if (prepaymentVal && !prepaymentToVal) conditionalMissing.push("Кому предоплата");
  const deliveryVal = (document.getElementById("delivery")?.value || "").trim();
  const deliveryDateVal = (document.getElementById("delivery_date")?.value || "").trim();
  if (deliveryVal && !deliveryDateVal) conditionalMissing.push("Дата");
  if (conditionalMissing.length > 0) {
    setMessage("Заполните поля: " + conditionalMissing.join(", "), "#d32f2f");
    updateConditionalRequiredHighlight();
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

  setMessage(
    wasEditing
    ? `Заявка #${savedOrderId} обновлена`
    : `Заявка #${savedOrderId} сохранена`,
    ""
  );
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