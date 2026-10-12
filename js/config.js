import { createReadFetch } from "./read-requests.js";
const { createClient } = window.supabase;

export function isOfflineWorkModeEnabled() {
  // Жёстко отключено: приложение работает только с сервером/БД.
  // (Раньше могла быть ручная активация через window.__OFFLINE_WORK_MODE_ENABLED__.)
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
export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
  // One bounded attempt; retrying POST/RPC could duplicate a successful write.
  db: { retry: false },
  global: { fetch: createReadFetch((...args) => fetch(...args), { baseUrl: SUPABASE_URL }) },
});
