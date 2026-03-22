import { state } from "./state.js";
import { loadBalance } from "./balance.js";
import { scheduleOrdersStickyHeaderUpdate } from "./ordersTableStickyHeader.js";
import { formatAmount, formatOrderIdTypeChip } from "./format.js";
import { applyHourlyMotivationToElement, scheduleHourlyMotivationUpdates } from "./motivationQuotes.js";
import { canAccessSection, isAdmin, isSectionHiddenFromNav, isUserLite } from "./roles.js";

/** Статусы: «Товар передан заказчику» или «Монтаж выполнен» */
const RICHER_STATUSES = new Set(["Товар передан заказчику", "Монтаж выполнен"]);

function orderIsUnpaidByRemainingTo(order) {
  const raw = (order.remaining_to || "").trim();
  return raw === "" || raw === "—";
}

/**
 * Сумма остатков по заказам: Оплачено = нет (пусто «Кому остаток») и статус
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
    if (!orderIsUnpaidByRemainingTo(order)) continue;
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
    searchBtn.hidden = sectionId !== "all" && sectionId !== STANDALONE_SECTION_NAV_ID;
  }
  if (sectionId !== "all") {
    closeOrdersSearchPanel();
  }
  syncOrdersSearchIconAccent();
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

  if (sectionId === "tasks-all") {
    void import("./tasks.js").then((m) => m.loadAllTasks());
  }
  if (sectionId === "order-tasks") {
    void import("./tasks.js").then((m) => m.loadOrderTasks());
  }

  updateBackToOrdersBtnVisibility(sectionId);
  scheduleOrdersStickyHeaderUpdate();
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

  const motivationEl = document.getElementById("sectionNavMotivationText");
  if (motivationEl) {
    scheduleHourlyMotivationUpdates(() => applyHourlyMotivationToElement(motivationEl));
  }
}
