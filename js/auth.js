import { isNetworkFetchError } from "./network-errors.js";
import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import { normalizeRole } from "./roles.js";
import { captureHref } from "./user-place.js";

const PROFILE_ROLE_CACHE_KEY = "orders_site_cache_profile_role_v1";

function loginPageHref() {
  try {
    const next = captureHref();
    if (!next || next === "/" || next === "/all" || next === "index.html") {
      return "login.html";
    }
    return `login.html?next=${encodeURIComponent(next)}`;
  } catch {
    return "login.html";
  }
}

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

/** Синхронно до loadProfile: первичная отрисовка до подтверждения роли сервером. */
export function hydrateCachedRoleFromStorage() {
  const raw = readCachedRoleRaw();
  if (raw == null) return;
  state.currentRole = normalizeRole(raw);
}

export async function checkAuth() {
  const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
  const sessionUser = sessionData?.session?.user;
  if (sessionError || !sessionUser) {
    window.location.href = loginPageHref();
    return null;
  }

  state.currentUser = sessionUser;

  void supabaseClient.auth
    .getUser()
    .then(({ data, error }) => {
      if (!error && data?.user) {
        state.currentUser = data.user;
        return;
      }
      if (error && !isNetworkFetchError(error)) {
        window.location.href = loginPageHref();
      }
    })
    .catch((e) => {
      if (!isNetworkFetchError(e)) {
        console.error("Ошибка проверки сессии:", e);
      }
    });

  return state.currentUser;
}

export async function loadProfile() {
  const { data, error } = await supabaseClient.from("profiles").select("role").eq("id", state.currentUser.id).single();
  if (error || !data) {
    state.currentRole = null;
    throw error || new Error("Не удалось загрузить профиль.");
  }

  state.currentRole = normalizeRole(data.role);
  writeCachedRole(data.role);
}

export async function logout() {
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
}