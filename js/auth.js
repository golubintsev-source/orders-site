import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import { normalizeRole } from "./roles.js";
import { isNetworkFetchError } from "./offline-cache.js";

/**
 * Вход в приложение без сети: getUser() ходит на Auth API и падает офлайн,
 * из‑за чего раньше срабатывал редирект на login и не вызывался loadOrders() с кэшем localStorage.
 * getSession() берёт JWT из локального хранилища Supabase и достаточен для старта UI.
 */
export async function checkAuth() {
  const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
  const sessionUser = sessionData?.session?.user;
  if (sessionError || !sessionUser) {
    window.location.href = "login.html";
    return null;
  }

  state.currentUser = sessionUser;

  if (typeof navigator !== "undefined" && navigator.onLine) {
    const { data, error } = await supabaseClient.auth.getUser();
    if (!error && data?.user) {
      state.currentUser = data.user;
    } else if (error && !isNetworkFetchError(error)) {
      window.location.href = "login.html";
      return null;
    }
  }

  return state.currentUser;
}

export async function loadProfile() {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("role")
    .eq("id", state.currentUser.id)
    .single();

  if (error) {
    console.error("Ошибка загрузки профиля:", error);
    state.currentRole = normalizeRole(null);
    return;
  }

  state.currentRole = normalizeRole(data?.role);
}

export async function logout() {
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
}