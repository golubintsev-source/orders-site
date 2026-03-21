import { state } from "./state.js";
import { loadBalance } from "./balance.js";
import { scheduleOrdersStickyHeaderUpdate } from "./ordersTableStickyHeader.js";
import { formatAmount, formatOrderIdTypeChip } from "./format.js";

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

  const isAdmin = state.currentRole === "admin";
  wrap.hidden = !isAdmin;
  if (!isAdmin) return;

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
  balance: "Баланс",
  settings: "Настройки",
};

let currentSectionId = "all";

function labelForSection(sectionId) {
  if (sectionId === "new") {
    if (!state.editingOrderId) return "Новый";
    const orderType = document.getElementById("order_type")?.value ?? "";
    const chip = formatOrderIdTypeChip(state.editingOrderId, orderType);
    return `Редактирование ${chip}`;
  }
  return SECTION_LABELS[sectionId] || sectionId;
}

function getContentSections() {
  return document.querySelectorAll(".content-section");
}

function updateDropdownItemsVisibility(activeId) {
  document.querySelectorAll(".section-nav-dropdown-item").forEach((btn) => {
    const id = btn.dataset.section;
    btn.hidden = id === activeId;
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

/** Лупа поиска по заказам — только на странице «Заказы». */
function updateOrdersSearchBtnVisibility(sectionId) {
  const searchBtn = document.getElementById("ordersSearchOpenBtn");
  if (searchBtn) {
    searchBtn.hidden = sectionId !== "all";
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

let sectionNavDocClickBound = false;

export function initSectionNavDropdown() {
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
        if (id) switchSection(id);
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
}
