import { supabaseClient } from "./config.js";

/** Таймаут проверки: при недоступной сети не ждём бесконечно. */
const HEALTH_TIMEOUT_MS = 8000;

/**
 * Лёгкий запрос к БД (как при загрузке таблицы заказов).
 * @returns {Promise<boolean>}
 */
export async function checkDatabaseAvailable() {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error("timeout")), HEALTH_TIMEOUT_MS);
  });
  try {
    const { error } = await Promise.race([
      supabaseClient.from("orders").select("id").limit(1),
      timeoutPromise,
    ]);
    if (error) return false;
    return true;
  } catch {
    return false;
  }
}

export function setDbUnavailableBannerVisible(visible) {
  const el = document.getElementById("dbUnavailableBanner");
  if (!el) return;
  el.hidden = !visible;
}
