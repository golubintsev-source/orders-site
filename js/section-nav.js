import { state } from "./state.js";
import { loadBalance } from "./balance.js";
import { scheduleOrdersStickyHeaderUpdate } from "./ordersTableStickyHeader.js";
import { formatAmount, formatOrderIdTypeChip } from "./format.js";
import { applyHourlyMotivationToElement, scheduleHourlyMotivationUpdates } from "./motivationQuotes.js";
import { canAccessSection, isAdmin, isSectionHiddenFromNav, isUserLite } from "./roles.js";

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
  "tasks-all": "Все задачи",
  "changes-all": "Все изменения",
  balance: "Баланс",
  settings: "Настройки",
};

let currentSectionId = "all";

/** Псевдо-раздел для отдельных страниц (history.html и т.д.): не совпадает с пунктами меню. */
export const STANDALONE_SECTION_NAV_ID = "__standalone__";

/** Разделы, где под шапкой в области страницы показывается «К заказам». */
const SECTIONS_WITH_BACK_TO_ORDERS = new Set([
  "calculations",
  "tasks-all",
  "changes-all",
  "order-tasks",
  "balance",
  "settings",
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

function updateOrdersTypeToggleVisibility(sectionId) {
  const wrap = document.querySelector(".orders-type-toggle-wrap");
  if (!wrap) return;
  wrap.hidden = sectionId !== "all";
}

function labelForSection(sectionId) {
  if (sectionId === "new") {
    if (!state.editingOrderId) return "Новый";
    const orderType = document.getElementById("order_type")?.value ?? "";
    const chip = formatOrderIdTypeChip(state.editingOrderId, orderType);
    return `Редактирование ${chip}`;
  }
  if (sectionId === "order-tasks" && state.tasksOrderId != null) {
    const o = state.allOrders?.find((x) => Number(x.id) === Number(state.tasksOrderId));
    if (o) {
      const chip = formatOrderIdTypeChip(state.tasksOrderId, o.order_type);
      return `Задачи ${chip}`;
    }
  }
  if (sectionId === "order-tasks") return "Задачи";
  return SECTION_LABELS[sectionId] || sectionId;
}

function getContentSections() {
  return document.querySelectorAll(".content-section");
}

function syncSectionNavDropdownUserLiteClass() {
  const panel = document.getElementById("sectionNavDropdownPanel");
  if (!panel) return;
  panel.classList.toggle("section-nav-dropdown-panel--user-lite", isUserLite());
}

function updateDropdownItemsVisibility(activeId) {
  syncSectionNavDropdownUserLiteClass();
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
 */
export function switchSection(sectionId) {
  if (!sectionId) return;
  if (!canAccessSection(sectionId)) {
    sectionId = "all";
  }
  const contentSections = getContentSections();
  if (!contentSections.length) return;

  currentSectionId = sectionId;
  contentSections.forEach((section) => {
    section.classList.toggle("active", section.id === `section-${sectionId}`);
  });

  updateCurrentLabel();
  updateDropdownItemsVisibility(sectionId);
  closeSectionNavDropdown();
  closeOrdersSearchPanel();
  updateOrdersSearchBtnVisibility(sectionId);

  if (sectionId === "balance") {
    loadBalance();
  }
  if (sectionId === "calculations") {
    void import("./calculations.js").then((m) => m.loadCalculations());
  }

  if (sectionId === "tasks-all") {
    void import("./tasks.js").then((m) => m.loadAllTasks());
  }
  if (sectionId === "changes-all") {
    void import("./all-changes.js").then((m) => m.loadAllChanges());
  }
  if (sectionId === "order-tasks") {
    void import("./tasks.js").then((m) => m.loadOrderTasks());
  }

  updateBackToOrdersBtnVisibility(sectionId);
  updateOrdersTypeToggleVisibility(sectionId);
  if (sectionId === "all") {
    void import("./ordersTableMobileFit.js").then((m) => m.scheduleApplyOrdersTableMobileFit());
  } else {
    void import("./ordersTableMobileFit.js").then((m) => {
      m.clearOrdersTableMobileFit();
      scheduleOrdersStickyHeaderUpdate();
    });
  }
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

export function initSectionNavDropdown(options = {}) {
  const { onSectionItemSelect } = options;

  const currentBtn = document.getElementById("sectionNavCurrentBtn");
  const panel = document.getElementById("sectionNavDropdownPanel");

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
            window.location.href = "index.html#orders-excel";
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
  updateOrdersTypeToggleVisibility(currentSectionId);

  const motivationEl = document.getElementById("sectionNavMotivationText");
  if (motivationEl) {
    scheduleHourlyMotivationUpdates(() => applyHourlyMotivationToElement(motivationEl));
  }
}
