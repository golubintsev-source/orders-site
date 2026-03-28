/**
 * iPhone / тач: подогнать ширину таблицы заказов под экран.
 * Важно: `transform: scale()` не меняет ширину в потоке — при `overflow: hidden` на родителе
 * остаётся видна только левая часть таблицы. Используем CSS `zoom` (уменьшает и раскладку в WebKit/Blink).
 */

import { refreshOrdersTableStickyHeader } from "./ordersTableStickyHeader.js";

const TOUCH_UI = "(hover: none) and (pointer: coarse)";

/** В Firefox до недавнего времени `zoom` не влиял на раскладку; проверяем поддержку. */
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

export function clearOrdersTableMobileFit() {
  const bottom = document.getElementById("ordersTableScrollBottom");
  const inner = document.getElementById("ordersTableScrollInner");
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
  if (!bottom || !inner) {
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

  const availW = bottom.clientWidth;
  const contentW = inner.scrollWidth;
  if (!availW || !contentW) {
    refreshOrdersTableStickyHeader();
    return;
  }

  const scale = Math.min(1, availW / contentW);
  if (scale >= 0.998) {
    refreshOrdersTableStickyHeader();
    return;
  }

  inner.style.zoom = String(scale);
  inner.classList.add("orders-table-inner--mobile-fit");
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
