/** Управление баннером «База данных недоступна»: только из `loadOrders()` при ошибке основной выборки заказов. */

export function setDbUnavailableBannerVisible(visible) {
  const el = document.getElementById("dbUnavailableBanner");
  if (!el) return;
  el.hidden = !visible;
}
