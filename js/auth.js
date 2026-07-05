import { supabaseClient, isOfflineWorkModeEnabled } from "./config.js";
import { state } from "./state.js";
import { normalizeRole } from "./roles.js";
import { isNetworkFetchError, raceWithTimeout } from "./offline-cache.js";

const PROFILE_ROLE_CACHE_KEY = "orders_site_cache_profile_role_v1";

function readCachedRoleRaw() {
  try {
    const raw = localStorage.getItem(PROFILE_ROLE_CACHE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return o?.role ?? null;
  } catch {
    return null;
  }
}

function writeCachedRole(role) {
  try {
    localStorage.setItem(
      PROFILE_ROLE_CACHE_KEY,
      JSON.stringify({ role: role ?? null, at: new Date().toISOString() }),
    );
  } catch {
    /* ignore */
  }
}

/** Синхронно до loadProfile: корректные фильтры user_lite при ранней отрисовке из localStorage. */
export function hydrateCachedRoleFromStorage() {
  const raw = readCachedRoleRaw();
  if (raw == null) return;
  state.currentRole = normalizeRole(raw);
}

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

  const shouldValidateWithServer = !isOfflineWorkModeEnabled() || navigator.onLine !== false;
  if (shouldValidateWithServer) {
    try {
      const { data, error } = await supabaseClient.auth.getUser();
      if (!error && data?.user) {
        state.currentUser = data.user;
      } else if (error && !isNetworkFetchError(error)) {
        window.location.href = "login.html";
        return null;
      }
    } catch (e) {
      if (!isNetworkFetchError(e)) {
        console.error("Ошибка проверки сессии:", e);
      }
    }
  }

  return state.currentUser;
}

export async function loadProfile() {
  if (isOfflineWorkModeEnabled() && typeof navigator !== "undefined" && navigator.onLine === false) {
    state.currentRole = normalizeRole(readCachedRoleRaw());
    return;
  }

  let res;
  try {
    res = isOfflineWorkModeEnabled()
      ? await raceWithTimeout(
          supabaseClient.from("profiles").select("role").eq("id", state.currentUser.id).single(),
        )
      : await supabaseClient.from("profiles").select("role").eq("id", state.currentUser.id).single();
  } catch (e) {
    if (e?.code === "TIMEOUT") {
      state.currentRole = normalizeRole(readCachedRoleRaw());
      return;
    }
    console.error("Ошибка загрузки профиля:", e);
    state.currentRole = normalizeRole(readCachedRoleRaw());
    return;
  }

  const { data, error } = res;
  if (error) {
    console.error("Ошибка загрузки профиля:", error);
    state.currentRole = normalizeRole(readCachedRoleRaw());
    return;
  }

  state.currentRole = normalizeRole(data?.role);
  writeCachedRole(data?.role);
}

export async function logout() {
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
}