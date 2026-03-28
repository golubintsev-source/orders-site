/**
 * iPhone / тач: уменьшить таблицу заказов так, чтобы все колонки попали в ширину экрана (CSS zoom).
 *
 * Важно:
 * - zoom на обёртке + overflow-x:hidden на #ordersTableScrollBottom обрезал таблицу слева (видно ~8 колонок).
 * - zoom и измерение ширины — на самой #ordersTable; перед измерением задаём width:max-content (!important),
 *   иначе таблица сжата под экран и scrollWidth ≈ экрану.
 */

import { refreshOrdersTableStickyHeader } from "./ordersTableStickyHeader.js";

const TOUCH_UI = "(hover: none) and (pointer: coarse)";

function zoomLayoutSupported() {
  if (typeof document === "undefined") return false;
  const el = document.createElement("div");
  try {
    el.style.zoom = "0.5";
    return el.style.zoom === "0.5";
  } catch {
    return false;
  }
}

function isTouchUi() {
  return typeof window.matchMedia === "function" && window.matchMedia(TOUCH_UI).matches;
}

function getOrdersTableEl() {
  return document.getElementById("ordersTable");
}

export function clearOrdersTableMobileFit() {
  const bottom = document.getElementById("ordersTableScrollBottom");
  const inner = document.getElementById("ordersTableScrollInner");
  const table = getOrdersTableEl();

  if (table) {
    table.style.removeProperty("zoom");
    table.style.removeProperty("width");
    table.style.removeProperty("max-width");
  }
  if (inner) {
    inner.style.removeProperty("zoom");
    inner.style.removeProperty("transform");
    inner.style.removeProperty("transform-origin");
    inner.style.removeProperty("width");
    inner.classList.remove("orders-table-inner--mobile-fit");
  }
  if (bottom) {
    bottom.style.removeProperty("height");
    bottom.style.removeProperty("overflow");
    bottom.classList.remove("orders-table-scroll--mobile-fit");
  }
}

/**
 * Пересчитать масштаб (после данных таблицы, смены ориентации, смены раздела).
 */
export function applyOrdersTableMobileFit() {
  const section = document.getElementById("section-all");
  const bottom = document.getElementById("ordersTableScrollBottom");
  const inner = document.getElementById("ordersTableScrollInner");
  const table = getOrdersTableEl();

  if (!bottom || !inner || !table) {
    refreshOrdersTableStickyHeader();
    return;
  }

  if (!section?.classList.contains("active") || !isTouchUi()) {
    clearOrdersTableMobileFit();
    refreshOrdersTableStickyHeader();
    return;
  }

  clearOrdersTableMobileFit();
  void inner.offsetWidth;

  if (!zoomLayoutSupported()) {
    refreshOrdersTableStickyHeader();
    return;
  }

  /* Реальная ширина всех колонок (не сжатая под 100% экрана) */
  table.style.setProperty("width", "max-content", "important");
  table.style.setProperty("max-width", "none", "important");
  void table.offsetWidth;
  void table.getBoundingClientRect();

  const availW = bottom.clientWidth;
  let contentW = Math.max(table.scrollWidth, table.offsetWidth, inner.scrollWidth);

  const headRow = table.querySelector("thead tr");
  if (headRow) {
    let sum = 0;
    headRow.querySelectorAll("th").forEach((th) => {
      sum += th.getBoundingClientRect().width;
    });
    contentW = Math.max(contentW, Math.ceil(sum));
  }

  const bodyRow = table.querySelector("tbody tr");
  if (bodyRow) {
    let sum = 0;
    bodyRow.querySelectorAll("td").forEach((td) => {
      sum += td.getBoundingClientRect().width;
    });
    contentW = Math.max(contentW, Math.ceil(sum));
  }

  if (!availW || !contentW) {
    clearOrdersTableMobileFit();
    refreshOrdersTableStickyHeader();
    return;
  }

  const scale = Math.min(1, availW / contentW);

  if (scale >= 0.998) {
    clearOrdersTableMobileFit();
    refreshOrdersTableStickyHeader();
    return;
  }

  table.style.zoom = String(scale);
  inner.classList.add("orders-table-inner--mobile-fit");
  bottom.classList.add("orders-table-scroll--mobile-fit");
  inner.scrollLeft = 0;

  refreshOrdersTableStickyHeader();
}

export function scheduleApplyOrdersTableMobileFit() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      applyOrdersTableMobileFit();
    });
  });
}

let inited = false;

export function initOrdersTableMobileFit() {
  if (inited) return;
  inited = true;

  document.addEventListener("orders-table-will-render", () => {
    clearOrdersTableMobileFit();
  });

  window.addEventListener(
    "resize",
    () => {
      scheduleApplyOrdersTableMobileFit();
    },
    { passive: true }
  );

  window.addEventListener(
    "orientationchange",
    () => {
      scheduleApplyOrdersTableMobileFit();
    },
    { passive: true }
  );

  if (typeof window.matchMedia === "function") {
    window.matchMedia(TOUCH_UI).addEventListener("change", () => {
      if (!isTouchUi()) clearOrdersTableMobileFit();
      else scheduleApplyOrdersTableMobileFit();
    });
  }

  const bottom = document.getElementById("ordersTableScrollBottom");
  if (bottom && typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      scheduleApplyOrdersTableMobileFit();
    });
    ro.observe(bottom);
  }
}
