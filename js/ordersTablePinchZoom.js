/**
 * Масштаб таблицы: только системный зум страницы (viewport в Safari/Chrome).
 * Кастомный щипок с CSS zoom отключён — он перехватывал жесты и мешал нативному масштабу.
 * При перерисовке таблицы снимаем возможные остаточные inline-стили и старый ключ sessionStorage.
 */

const STORAGE_KEY = "ordersTablePinchZoom";

function clearPinchZoomStyles() {
  const inner = document.getElementById("ordersTableScrollInner");
  const table = document.getElementById("ordersTable");
  const wrap = document.getElementById("ordersTablePinchWrap");
  if (inner) {
    inner.style.removeProperty("zoom");
    inner.classList.remove("orders-table-inner--pinch-zoom");
  }
  table?.style.removeProperty("zoom");
  wrap?.style.removeProperty("zoom");
  wrap?.classList.remove("orders-table--pinch-zoomed");
  table?.classList.remove("orders-table--pinch-zoomed");
}

function clearLegacySessionStorage() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** После перерисовки tbody — убрать остатки zoom, если были до обновления. */
export function reapplyOrdersTablePinchZoom() {
  clearPinchZoomStyles();
}

export function resetOrdersTablePinchZoom() {
  clearLegacySessionStorage();
  reapplyOrdersTablePinchZoom();
}

/** Один раз при загрузке: очистить старый сохранённый масштаб и стили. */
export function initOrdersTablePinchZoom() {
  clearLegacySessionStorage();
  clearPinchZoomStyles();
}
