const { createClient } = window.supabase;

export const SUPABASE_URL =
  typeof window !== "undefined" && window.__SUPABASE_URL__
    ? window.__SUPABASE_URL__
    : "https://yizwpogwabosuguakyzt.supabase.co";
export const SUPABASE_KEY =
  typeof window !== "undefined" && window.__SUPABASE_ANON_KEY__
    ? window.__SUPABASE_ANON_KEY__
    : "sb_publishable_e1pJB18UsEV-o_M43ROi9w_4mS--LrF";

export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);