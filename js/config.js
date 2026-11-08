import { createReadFetch } from "./read-requests.js";
const { createClient } = window.supabase;

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
const readFetch = createReadFetch((...args) => fetch(...args), { baseUrl: SUPABASE_URL });
export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
  // One bounded attempt; retrying POST/RPC could duplicate a successful write.
  db: { retry: false },
  global: { fetch: (input, init) => {
    const run = () => readFetch(input, init);
    return window.__appStartup?.trackRead(input, init, run) ?? run();
  } },
});
