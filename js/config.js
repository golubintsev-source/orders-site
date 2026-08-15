const { createClient } = window.supabase;

/**
 * Режим офлайн-работы отключён по умолчанию (только сервер).
 * Включение: window.__OFFLINE_WORK_MODE_ENABLED__ = true до загрузки модулей.
 */
export function isOfflineWorkModeEnabled() {
  if (typeof window !== "undefined" && typeof window.__OFFLINE_WORK_MODE_ENABLED__ === "boolean") {
    return window.__OFFLINE_WORK_MODE_ENABLED__;
  }
  return false;
}

export const SUPABASE_URL =
  typeof window !== "undefined" && window.__SUPABASE_URL__
    ? window.__SUPABASE_URL__
    : "https://yizwpogwabosuguakyzt.supabase.co";
export const SUPABASE_KEY =
  typeof window !== "undefined" && window.__SUPABASE_ANON_KEY__
    ? window.__SUPABASE_ANON_KEY__
    : "sb_publishable_e1pJB18UsEV-o_M43ROi9w_4mS--LrF";

/**
 * Прямые запросы в Supabase (без Vercel /api/supabase-proxy).
 * Раньше прокси добавлял лишний hop и замедлял мобильный/PWA старт.
 */
export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
