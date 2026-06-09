import { state } from "./state.js";

/**
 * Баннер «База данных недоступна».
 * @param {boolean} visible
 * @param {{ cacheMode?: boolean }} [opts] cacheMode — показать текст про локальную копию на устройстве
 */
export function setDbUnavailableBannerVisible(visible, opts = {}) {
  const el = document.getElementById("dbUnavailableBanner");
  const textEl = document.getElementById("dbUnavailableBannerText");
  if (!el) return;
  el.hidden = !visible;
  if (textEl) {
    textEl.textContent = opts.cacheMode
      ? "Нет связи с базой данных. Показана последняя сохранённая на этом устройстве копия заказов; новые заявки сохраняются здесь и отправятся в базу при появлении связи."
      : "База данных недоступна";
  }
}

/** Показать/скрыть баннер по фактическому офлайн-состоянию приложения. */
export function syncDbUnavailableBanner() {
  const offline =
    state.ordersFromCache ||
    state.dbUnavailable ||
    (typeof navigator !== "undefined" && navigator.onLine === false);
  if (!offline) {
    setDbUnavailableBannerVisible(false);
    return;
  }
  setDbUnavailableBannerVisible(true, { cacheMode: state.allOrders.length > 0 });
}
