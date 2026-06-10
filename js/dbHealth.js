import { state } from "./state.js";

/** Баннер «Нет связи с базой данных». */
export function setDbUnavailableBannerVisible(visible) {
  const el = document.getElementById("dbUnavailableBanner");
  const textEl = document.getElementById("dbUnavailableBannerText");
  if (!el) return;
  el.hidden = !visible;
  if (textEl) {
    textEl.textContent = "Нет связи с базой данных";
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
  setDbUnavailableBannerVisible(true);
}
