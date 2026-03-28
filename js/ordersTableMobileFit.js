/**
 * Тач-устройства: раньше здесь был zoom таблицы — на iOS 18 он давал обрезку и отключал горизонтальный скролл.
 * Сейчас только снимаем возможные inline-стили со старых сессий и обновляем клон шапки (на таче клон отключён в CSS).
 */

import { refreshOrdersTableStickyHeader } from "./ordersTableStickyHeader.js";

export function clearOrdersTableMobileFit() {
  const bottom = document.getElementById("ordersTableScrollBottom");
  const inner = document.getElementById("ordersTableScrollInner");
  const table = document.getElementById("ordersTable");

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

export function applyOrdersTableMobileFit() {
  clearOrdersTableMobileFit();
  refreshOrdersTableStickyHeader();
}

export function scheduleApplyOrdersTableMobileFit() {
  requestAnimationFrame(() => {
    applyOrdersTableMobileFit();
  });
}

export function initOrdersTableMobileFit() {
  document.addEventListener("orders-table-will-render", () => {
    clearOrdersTableMobileFit();
  });
}
