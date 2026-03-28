/**
 * Тач: очистка legacy inline-стилей таблицы, обновление клона шапки.
 * Масштаб двумя пальцами — ordersTablePinchZoom.js (zoom на #ordersTableScrollInner не сбрасываем здесь).
 */

import { refreshOrdersTableStickyHeader } from "./ordersTableStickyHeader.js";
import { reapplyOrdersTablePinchZoom } from "./ordersTablePinchZoom.js";

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
    /* zoom для щипка задаёт ordersTablePinchZoom — не трогаем inner.style.zoom */
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
  reapplyOrdersTablePinchZoom();
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
