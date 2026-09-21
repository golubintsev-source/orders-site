import { state } from "./state.js";
import { loadBalance } from "./balance.js";
import { scheduleOrdersStickyHeaderUpdate } from "./ordersTableStickyHeader.js";
import { formatAmount, formatOrderIdTypeChip } from "./format.js";
import { applyHourlyMotivationToElement, scheduleHourlyMotivationUpdates } from "./motivationQuotes.js";
import { canAccessSection, isAdmin, isSectionHiddenFromNav, isUserLite, isUserShop } from "./roles.js";
import { getRouteSectionFromUrl, hrefToOrdersExcelExport, syncBrowserUrlToSection } from "./app-routes.js";
import { navigateWithUserPlace, scheduleSaveUserPlace } from "./user-place.js";
import {
  consumeSectionSwitchMs,
  logSpaSectionAccess,
  markSectionSwitchStart,
  measureAfterPaint,
  measureNavigationResponseMs,
} from "./access-log.js";

/** Статусы: «Товар передан заказчику» или «Монтаж выполнен» */
const RICHER_STATUSES = new Set(["Товар передан заказчику", "Монтаж выполнен"]);

function parseLooseNumber(raw) {
  if (raw == null) return null;
  const s0 = String(raw).trim();
  if (!s0) return null;
  const s = s0.replace(/[\s\u00A0\u202F]/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

function orderIsPaid(order) {
  const remainingToRaw = (order.remaining_to || "").trim();
  const paidByRemainingTo = remainingToRaw !== "" && remainingToRaw !== "—";

  const remainingAmount = parseLooseNumber(order.remaining_amount);
  const paidByRemainingAmountZero = remainingAmount != null && Math.abs(remainingAmount) < 1e-9;

  return paidByRemainingTo || paidByRemainingAmountZero;
}

/**
 * Сумма остатков по заказам: Оплачено = нет и статус
 * «Товар передан заказчику» или «Монтаж выполнен».
 */
export function updateSectionNavRicherStat() {
  const wrap = document.getElementById("sectionNavRicherStat");
  const el = document.getElementById("sectionNavRicherSum");
  if (!wrap || !el) return;

  wrap.hidden = !isAdmin();
  if (!isAdmin()) return;

  let sum = 0;
  for (const order of state.allOrders || []) {
    if (orderIsPaid(order)) continue;
    const st = (order.payment_status || "").trim();
    if (!RICHER_STATUSES.has(st)) continue;
    const rem = order.remaining_amount;
    if (rem != null && rem !== "") {
      const n = Number(rem);
      if (Number.isFinite(n)) sum += n;
    }
  }

  el.textContent = `${formatAmount(sum)}\u00A0₽`;
}

const SECTION_LABELS = {
  all: "Заказы",
  calculations: "Расчеты",
  excess: "Излишки",
  "tasks-all": "Мои задачи",
  "changes-all": "Все изменения",
  balance: "Баланс",
  "manager-salary": "Зарплата менеджера",
  "route-sheet": "Маршрутный лист",
  settings: "Настройки",
  "speed-test": "Тест скорости",
  statistics: "Статистика",
  "statistics-balance": "Статистика баланса",
  debts: "Долги",
  messages: "Чаты",
  voice: "Голосовое управление",
};

/** Совпадает с URL после boot-route.js (иначе шапка/лупа до main рассинхронизированы). */
let currentSectionId = getRouteSectionFromUrl();

/** Псевдо-раздел для отдельных страниц (history.html и т.д.): не совпадает с пунктами меню. */
export const STANDALONE_SECTION_NAV_ID = "__standalone__";

/** Разделы, где под шапкой в области страницы показывается «К заказам». */
const SECTIONS_WITH_BACK_TO_ORDERS = new Set([
  "calculations",
  "excess",
  "tasks-all",
  "changes-all",
  "order-tasks",
  "messages",
  "voice",
  "balance",
  "manager-salary",
  "route-sheet",
  "settings",
  "speed-test",
  "statistics",
  "statistics-balance",
  "debts",
]);

function updateBackToOrdersBtnVisibility(sectionId) {
  const show =
    SECTIONS_WITH_BACK_TO_ORDERS.has(sectionId) || sectionId === STANDALONE_SECTION_NAV_ID;
  const bar = document.getElementById("backToOrdersBar");
  if (bar) {
    bar.hidden = !show;
    return;
  }
  const btn = document.getElementById("backToOrdersBtn");
  if (btn) btn.hidden = !show;
}

function labelForSection(sectionId) {
  if (sectionId === "new") {
    if (state.viewingOrderId != null) {
      const o = state.allOrders?.find((x) => Number(x.id) === Number(state.viewingOrderId));
      const orderType = o?.order_type ?? document.getElementById("order_type")?.value ?? "";
      const chip = formatOrderIdTypeChip(state.viewingOrderId, orderType);
      return `Просмотр ${chip}`;
    }
    if (!state.editingOrderId) return "Новый";
    const orderType = document.getElementById("order_type")?.value ?? "";
    const chip = formatOrderIdTypeChip(state.editingOrderId, orderType);
    return `Редактирование ${chip}`;
  }
  if (sectionId === "order-tasks") return "Задачи";
  return SECTION_LABELS[sectionId] || sectionId;
}

function getContentSections() {
  return document.querySelectorAll(".content-section");
}

/** Помечает поля, которые мы временно отключили для iOS (не трогаем изначально disabled). */
const IOS_FORM_LOCK_ATTR = "data-ios-form-lock";

function lockFormControl(el) {
  if (!(el instanceof HTMLElement)) return;
  if (el.disabled || el.getAttribute(IOS_FORM_LOCK_ATTR) === "1") return;
  el.setAttribute(IOS_FORM_LOCK_ATTR, "1");
  el.disabled = true;
}

function unlockFormControl(el) {
  if (!(el instanceof HTMLElement)) return;
  if (el.getAttribute(IOS_FORM_LOCK_ATTR) !== "1") return;
  el.removeAttribute(IOS_FORM_LOCK_ATTR);
  el.disabled = false;
}

/**
 * iOS Safari/PWA показывает над клавиатурой панель ↑↓/✓ (form assistant), если на странице
 * несколько input/textarea/select — даже в секциях с display:none. Отключаем поля
 * неактивных разделов, чтобы на экране сообщений оставалось одно поле ввода.
 */
export function syncIosFormControlLocks(activeSectionId = currentSectionId) {
  const activeSection = document.getElementById(`section-${activeSectionId}`);
  getContentSections().forEach((section) => {
    const active = section === activeSection;
    section.toggleAttribute("inert", !active);
    section.querySelectorAll("input, textarea, select").forEach((el) => {
      if (active) unlockFormControl(el);
      else lockFormControl(el);
    });
  });

  const searchInput = document.getElementById("ordersSearchPopupInput");
  const searchPanel = document.getElementById("ordersSearchDropdownPanel");
  if (searchInput) {
    if (searchPanel && !searchPanel.hidden) unlockFormControl(searchInput);
    else lockFormControl(searchInput);
  }
}

function isTextInputFocused() {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT";
}

/** Класс на <html>, когда открыта экранная клавиатура — ужимаем чат и убираем safe-area у композеров. */
export function initKeyboardOpenClass() {
  const root = document.documentElement;
  let focusOutTimer = 0;
  const sync = () => {
    const vv = window.visualViewport;
    if (!vv) {
      root.classList.remove("keyboard-open");
      root.style.removeProperty("--app-visible-height");
      return;
    }
    const overlap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    // Нижняя панель Safari/Chrome тоже уменьшает visualViewport — это не клавиатура.
    const open = isTextInputFocused() && overlap > 120;
    root.classList.toggle("keyboard-open", open);
    if (open) {
      root.style.setProperty("--app-visible-height", `${Math.round(vv.height)}px`);
    } else {
      ro