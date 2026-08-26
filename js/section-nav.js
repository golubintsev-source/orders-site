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
      root.style.removeProperty("--app-visible-height");
    }
  };
  sync();
  window.visualViewport?.addEventListener("resize", sync);
  window.visualViewport?.addEventListener("scroll", sync);
  window.addEventListener("focusin", () => {
    window.clearTimeout(focusOutTimer);
    sync();
  });
  window.addEventListener("focusout", () => {
    // iOS обновляет visualViewport после закрытия клавиатуры с задержкой.
    window.clearTimeout(focusOutTimer);
    focusOutTimer = window.setTimeout(sync, 280);
    queueMicrotask(sync);
  });
}

function syncSectionNavDropdownRoleClasses() {
  const panel = document.getElementById("sectionNavDropdownPanel");
  if (!panel) return;
  panel.classList.toggle("section-nav-dropdown-panel--user-lite", isUserLite());
  panel.classList.toggle("section-nav-dropdown-panel--user-shop", isUserShop());
}

function updateDropdownItemsVisibility(activeId) {
  syncSectionNavDropdownRoleClasses();
  document.querySelectorAll(".section-nav-dropdown-item").forEach((btn) => {
    const id = btn.dataset.section;
    btn.hidden = id === activeId || isSectionHiddenFromNav(id);
  });
}

function updateCurrentLabel() {
  const labelEl = document.getElementById("sectionNavCurrentLabel");
  if (labelEl) labelEl.textContent = labelForSection(currentSectionId);
}

/** Синяя лупа, если в скрытом поле поиска есть текст; иначе серая (через color у кнопки). */
export function syncOrdersSearchIconAccent() {
  const btn = document.getElementById("ordersSearchOpenBtn");
  const input = document.getElementById("clientSearch");
  if (!btn || !input) return;
  const hasQuery = (input.value || "").trim().length > 0;
  btn.classList.toggle("section-nav-search-btn--active-query", hasQuery);
}

/** Закрыть выпадающее меню поиска (лупа). */
export function closeOrdersSearchPanel() {
  const panel = document.getElementById("ordersSearchDropdownPanel");
  const btn = document.getElementById("ordersSearchOpenBtn");
  if (panel) panel.hidden = true;
  if (btn) {
    btn.setAttribute("aria-expanded", "false");
    btn.classList.remove("section-nav-search-btn--open");
  }
  syncIosFormControlLocks();
}

/** Лупа поиска по заказам — на «Заказы» и на отдельных страницах с шапкой (history.html). */
function updateOrdersSearchBtnVisibility(sectionId) {
  const searchBtn = document.getElementById("ordersSearchOpenBtn");
  if (searchBtn) {
    const isOrdersPage = sectionId === "all";
    searchBtn.hidden = false;
    searchBtn.dataset.navMode = isOrdersPage ? "search" : "orders";

    // Иконки: на странице «Заказы» показываем лупу, иначе показываем картинку «Заказы».
    if (isOrdersPage) {
      searchBtn.setAttribute("title", "Поиск по заказам");
      searchBtn.setAttribute("aria-label", "Поиск по заказам");
      searchBtn.innerHTML = `
        <svg class="section-nav-search-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"></circle>
          <path d="M20 20l-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
        </svg>
      `;
      searchBtn.classList.remove("section-nav-search-btn--active-orders");
    } else {
      searchBtn.setAttribute("title", "Заказы");
      searchBtn.setAttribute("aria-label", "Заказы");
      // Простой "документ/список" как иконка «Заказы».
      searchBtn.innerHTML = `
        <svg class="section-nav-orders-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 2h9l3 3v17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path>
          <path d="M15 2v5h5" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path>
          <path d="M7 13h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
          <path d="M7 17h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
        </svg>
      `;
      searchBtn.classList.remove("section-nav-search-btn--active-query");
    }
  }

  if (sectionId !== "all") closeOrdersSearchPanel();
  if (sectionId === "all") syncOrdersSearchIconAccent();
}

export function closeSectionNavDropdown() {
  const panel = document.getElementById("sectionNavDropdownPanel");
  const btn = document.getElementById("sectionNavCurrentBtn");
  if (panel) {
    panel.hidden = true;
  }
  if (btn) {
    btn.setAttribute("aria-expanded", "false");
    btn.classList.remove("section-nav-current--open");
  }
}

function openSectionNavDropdown() {
  closeOrdersSearchPanel();
  const panel = document.getElementById("sectionNavDropdownPanel");
  const btn = document.getElementById("sectionNavCurrentBtn");
  if (!panel || !btn) return;
  updateDropdownItemsVisibility(currentSectionId);
  panel.hidden = false;
  btn.setAttribute("aria-expanded", "true");
  btn.classList.add("section-nav-current--open");
}

function toggleSectionNavDropdown() {
  const panel = document.getElementById("sectionNavDropdownPanel");
  if (!panel) return;
  if (panel.hidden) {
    openSectionNavDropdown();
  } else {
    closeSectionNavDropdown();
  }
}

/**
 * Переключить раздел и обновить заголовок в шапке (без открытого дропдауна).
 * @param {string} sectionId
 * @param {{ skipUrlSync?: boolean, logInitialAccess?: boolean, skipAccessLog?: boolean, restoreMessagesChat?: boolean }} [opts]
 */
export function switchSection(sectionId, opts = {}) {
  if (!sectionId) return;
  if (sectionId === "tasks-all") {
    state.tasksOrderId = null;
  }
  if (!canAccessSection(sectionId)) {
    sectionId = "all";
  }
  const contentSections = getContentSections();
  if (!contentSections.length) return;

  const prevSectionId = currentSectionId;
  const { skipUrlSync = false, skipAccessLog = false } = opts;

  if (prevSectionId !== sectionId) {
    markSectionSwitchStart();
  }

  currentSectionId = sectionId;
  contentSections.forEach((section) => {
    section.classList.toggle("active", section.id === `section-${sectionId}`);
  });

  updateCurrentLabel();
  updateDropdownItemsVisibility(sectionId);
  closeSectionNavDropdown();
  closeOrdersSearchPanel();
  updateOrdersSearchBtnVisibility(sectionId);
  syncIosFormControlLocks(sectionId);

  if (sectionId === "balance") {
    loadBalance({ recordView: true });
  }
  if (sectionId === "manager-salary") {
    void import("./manager-salary.js")
      .then((m) => m.loadManagerSalary())
      .catch((err) => console.error("Зарплата менеджера: не удалось загрузить раздел", err));
  }
  if (sectionId === "route-sheet") {
    void import("./route-sheet.js").then((m) => m.loadRouteSheet());
  }
  if (prevSectionId === "route-sheet" && sectionId !== "route-sheet") {
    void import("./route-sheet.js").then((m) => m.bumpRouteDeliveryMapGeneration());
  }
  if (sectionId === "calculations") {
    void import("./calculations.js").then((m) => m.loadCalculations());
  }
  if (sectionId === "excess") {
    void import("./excess.js?v=37").then((m) => m.loadExcesses());
  }

  if (sectionId === "tasks-all") {
    void import("./tasks.js").then((m) => {
      m.loadAllTasks();
      void m.ensureOrderTaskExecutorsLoaded();
    });
    void import("./push-notifications.js").then((m) => m.clearPushBadge());
  }
  if (sectionId === "order-tasks") {
    void import("./tasks.js").then((m) => m.loadOrderTasks());
    void import("./push-notifications.js").then((m) => m.clearPushBadge());
  }
  if (sectionId === "changes-all") {
    void import("./all-changes.js").then((m) => m.loadAllChanges());
  }
  if (sectionId === "statistics") {
    void import("./statistics.js").then((m) => m.loadStatistics({ refreshDefaultRange: true }));
  }
  if (sectionId === "statistics-balance") {
    void import("./statistics-balance.js").then((m) =>
      m.loadStatisticsBalance({ refreshDefaultRange: true }),
    );
  }
  if (sectionId === "debts") {
    void import("./debts.js").then((m) => m.loadDebts());
  }
  if (sectionId === "settings") {
    void import("./settings.js").then((m) => m.applySettingsAdminBlocksVisibility());
    void import("./push-notifications.js").then((m) => m.refreshPushNotificationsUi());
  }
  if (prevSectionId === "messages" && sectionId !== "messages") {
    void import("./messages.js").then((m) => m.stopMessagesPolling());
  }
  if (sectionId === "messages") {
    void import("./messages.js").then((m) => {
      m.onMessagesSectionEnter({ restoreFromUrl: Boolean(opts.restoreMessagesChat) });
    });
  }
  if (prevSectionId === "voice" && sectionId !== "voice") {
    void import("./voice.js").then((m) => m.onVoiceSectionLeave());
  }
  if (sectionId === "voice") {
    void import("./voice.js").then((m) => m.onVoiceSectionEnter());
  }

  updateBackToOrdersBtnVisibility(sectionId);
  if (sectionId === "all") {
    void import("./ordersTableMobileFit.js").then((m) => m.scheduleApplyOrdersTableMobileFit());
  } else {
    void import("./ordersTableMobileFit.js").then((m) => {
      m.clearOrdersTableMobileFit();
      scheduleOrdersStickyHeaderUpdate();
    });
  }

  if (!skipUrlSync && prevSectionId !== sectionId) {
    syncBrowserUrlToSection(sectionId);
  }

  if (!skipAccessLog) {
    if (prevSectionId !== sectionId) {
      measureAfterPaint(() => {
        logSpaSectionAccess(sectionId, consumeSectionSwitchMs());
      });
    } else if (opts.logInitialAccess) {
      measureAfterPaint(() => {
        logSpaSectionAccess(sectionId, measureNavigationResponseMs());
      });
    }
  }

  scheduleSaveUserPlace();
}

/** Обновить только текст текущего раздела (например «Новый» ↔ «Редактирование»). */
export function refreshSectionNavLabel() {
  updateCurrentLabel();
  updateDropdownItemsVisibility(currentSectionId);
}

export function getCurrentSectionId() {
  return currentSectionId;
}

/** Заголовок в шапке и псевдо-раздел для выпадающего меню (страницы вне index.html). */
export function setStandaloneSectionNavLabel(text) {
  const labelEl = document.getElementById("sectionNavCurrentLabel");
  if (labelEl) labelEl.textContent = text;
  currentSectionId = STANDALONE_SECTION_NAV_ID;
  updateDropdownItemsVisibility(currentSectionId);
  updateOrdersSearchBtnVisibility(currentSectionId);
  updateBackToOrdersBtnVisibility(currentSectionId);
  syncIosFormControlLocks(currentSectionId);
}

/** После loadProfile(): скрыть пункты меню по роли и выйти из запрещённого раздела. */
export function refreshSectionNavAfterProfile() {
  if (!canAccessSection(currentSectionId)) {
    switchSection("all");
  } else {
    updateDropdownItemsVisibility(currentSectionId);
  }
  updateSectionNavRicherStat();
}

let sectionNavDocClickBound = false;

/**
 * Кнопки шапки (Мои задачи / Чаты / …) должны работать сразу после bindUIEvents,
 * а не ждать отложенной вторичной инициализации (~600 КБ) — иначе на iPhone PWA
 * тап по видимой кнопке «ничего не открывает».
 * @param {string} elementId
 * @param {string} sectionId
 * @param {(id: string) => void} [onSectionItemSelect]
 */
function bindTopbarSectionNavButton(elementId, sectionId, onSectionItemSelect) {
  const btn = document.getElementById(elementId);
  if (!btn || btn.dataset.navBound === "1") return;
  btn.dataset.navBound = "1";
  let lastAt = 0;
  const open = (e) => {
    // На iPhone первый тап рядом с полями/после клавиатуры иногда не даёт click.
    if (e.type === "touchstart" || e.type === "pointerdown") {
      if (e.type === "pointerdown" && typeof e.button === "number" && e.button !== 0) return;
      if (e.cancelable) e.preventDefault();
    }
    const now = Date.now();
    if (now - lastAt < 350) return;
    lastAt = now;
    if (typeof onSectionItemSelect === "function") {
      onSectionItemSelect(sectionId);
    } else {
      switchSection(sectionId);
    }
  };
  btn.addEventListener("touchstart", open, { passive: false });
  btn.addEventListener("pointerdown", open);
  btn.addEventListener("click", open);
}

export function initSectionNavDropdown(options = {}) {
  const { onSectionItemSelect } = options;

  const currentBtn = document.getElementById("sectionNavCurrentBtn");
  const panel = document.getElementById("sectionNavDropdownPanel");

  // Ранняя привязка: не зависит от import("./tasks.js") / idle.
  bindTopbarSectionNavButton("myTasksNavBtn", "tasks-all", onSectionItemSelect);

  if (currentBtn) {
    currentBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleSectionNavDropdown();
    });
  }

  if (panel) {
    panel.addEventListener("click", (e) => e.stopPropagation());
    panel.querySelectorAll(".section-nav-dropdown-item").forEach((item) => {
      item.addEventListener("click", () => {
        const id = item.dataset.section;
        if (!id) return;
        if (id === "orders-excel") {
          if (!canAccessSection("orders-excel")) return;
          const hasOrdersTable = Boolean(document.getElementById("ordersTable"));
          if (!hasOrdersTable) {
            navigateWithUserPlace(hrefToOrdersExcelExport());
            closeSectionNavDropdown();
            return;
          }
          void import("./ordersExcelExport.js").then((m) => m.exportOrdersToExcel());
          closeSectionNavDropdown();
          return;
        }
        if (typeof onSectionItemSelect === "function") {
          onSectionItemSelect(id);
          closeSectionNavDropdown();
        } else {
          switchSection(id);
        }
      });
    });
  }

  if (!sectionNavDocClickBound) {
    sectionNavDocClickBound = true;
    document.addEventListener("click", () => {
      const p = document.getElementById("sectionNavDropdownPanel");
      if (p && !p.hidden) closeSectionNavDropdown();
      closeOrdersSearchPanel();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const searchPanel = document.getElementById("ordersSearchDropdownPanel");
      if (searchPanel && !searchPanel.hidden) {
        e.preventDefault();
        closeOrdersSearchPanel();
        return;
      }
      const p = document.getElementById("sectionNavDropdownPanel");
      if (p && !p.hidden) {
        e.preventDefault();
        closeSectionNavDropdown();
      }
    });
  }

  const ordersSearchPanel = document.getElementById("ordersSearchDropdownPanel");
  if (ordersSearchPanel) {
    ordersSearchPanel.addEventListener("click", (e) => e.stopPropagation());
  }

  updateCurrentLabel();
  updateDropdownItemsVisibility(currentSectionId);
  updateOrdersSearchBtnVisibility(currentSectionId);
  updateBackToOrdersBtnVisibility(currentSectionId);
  syncIosFormControlLocks(currentSectionId);
  initKeyboardOpenClass();

  const motivationEl = document.getElementById("sectionNavMotivationText");
  if (motivationEl) {
    scheduleHourlyMotivationUpdates(() => applyHourlyMotivationToElement(motivationEl));
  }
}
