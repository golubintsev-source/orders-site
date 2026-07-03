import { supabaseClient } from "./config.js";
import { hrefToHome } from "./app-routes.js";
import { flushPendingAccessLogs } from "./access-log.js";

function stripKeyFromUrl() {
  const u = new URL(window.location.href);
  u.searchParams.delete("key");
  const path = u.pathname + u.search;
  history.replaceState(null, "", path || "/login.html");
}

/**
 * Вход по секретной ссылке: login.html?key=...
 * @returns {Promise<boolean>} true, если параметр key был в URL (успех или ошибка)
 */
export async function trySecretLoginFromUrl() {
  const key = new URLSearchParams(window.location.search).get("key");
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
      if (msg) msg.innerText = "Ссылка недействительна";
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

    window.location.href = hrefToHome();
    return true;
  } catch (e) {
    console.error("secret-login:", e);
    stripKeyFromUrl();
    if (msg) msg.innerText = "Ошибка подключения";
    return true;
  }
}
