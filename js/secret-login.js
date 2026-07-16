import { supabaseClient } from "./config.js";
import { hrefToHome } from "./app-routes.js";
import { getResumeHref, resolvePlaceHref } from "./user-place.js";
import { flushPendingAccessLogs } from "./access-log.js";

export function getLoginKeyFromUrl() {
  return new URLSearchParams(window.location.search).get("key")?.trim() || null;
}

function getSafeNextHref() {
  const raw = new URLSearchParams(window.location.search).get("next")?.trim();
  if (!raw) return null;
  if (raw.startsWith("//") || raw.includes("://")) return null;
  if (raw.startsWith("/") || /^[a-zA-Z0-9._-]+\.html/.test(raw)) {
    return resolvePlaceHref(raw);
  }
  return null;
}

function hrefAfterLogin(userId) {
  return getSafeNextHref() || getResumeHref(userId, hrefToHome());
}

function stripKeyFromUrl() {
  const u = new URL(window.location.href);
  if (!u.searchParams.has("key")) return;
  u.searchParams.delete("key");
  const path = u.pathname + u.search + u.hash;
  history.replaceState(null, "", path || "/");
}

/**
 * Вход по персональной ссылке: ?key=... (login.html или любая страница приложения).
 * @returns {Promise<boolean>} true, если параметр key был в URL (успех или ошибка)
 */
export async function trySecretLoginFromUrl() {
  const key = getLoginKeyFromUrl();
  if (!key) return false;

  const msg = document.getElementById("message");
  if (msg) msg.innerText = "Вход…";

  try {
    const res = await fetch("/api/secret-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: key }),
    });

    stripKeyFromUrl();

    if (!res.ok) {
      let text = "Ссылка недействительна";
      try {
        const err = await res.json();
        if (err?.code === "not_configured" || res.status === 503) {
          text = "Вход по ссылке не настроен на сервере";
        } else if (res.status === 401) {
          text = "Ссылка недействительна или устарела";
        } else if (res.status === 500) {
          const detail = typeof err?.detail === "string" ? err.detail : "";
          if (err?.message === "Login lookup failed") {
            text = "Ошибка поиска ключа (проверьте SQL login_key в Supabase)";
          } else if (detail.includes("SUPABASE_ANON_KEY")) {
            text = "На Vercel добавьте SUPABASE_ANON_KEY — legacy anon key (eyJ...) из Supabase → Settings → API";
          } else if (detail) {
            text = `Ошибка авторизации: ${detail}`;
          } else {
            text = "Ошибка авторизации (проверьте email пользователя в Supabase Auth)";
          }
        }
      } catch {
        /* keep default */
      }
      if (msg) msg.innerText = text;
      return true;
    }

    const data = await res.json();
    const { error } = await supabaseClient.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });

    if (error) {
      if (msg) msg.innerText = "Ошибка входа";
      return true;
    }

    const { data: sessionData } = await supabaseClient.auth.getSession();
    const user = sessionData?.session?.user;
    if (user) {
      await flushPendingAccessLogs(user);
    }

    window.location.href = hrefAfterLogin(user?.id);
    return true;
  } catch (e) {
    console.error("secret-login:", e);
    stripKeyFromUrl();
    if (msg) msg.innerText = "Ошибка подключения";
    return true;
  }
}
