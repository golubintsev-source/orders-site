import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import { isAdmin } from "./roles.js";

let cachedVapidPublicKey = null;

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent || "");
}

/** iOS: push только в установленном PWA (иконка на экране). */
export function isStandalonePwa() {
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  if (window.navigator.standalone === true) return true;
  return false;
}

export function isPushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function fetchVapidPublicKey() {
  if (cachedVapidPublicKey) return cachedVapidPublicKey;
  const res = await fetch("/api/push-config");
  if (!res.ok) return null;
  const data = await res.json();
  cachedVapidPublicKey = data?.publicKey || null;
  return cachedVapidPublicKey;
}

async function getServiceWorkerRegistration() {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.ready;
}

function subscriptionKeys(sub) {
  const json = sub.toJSON();
  return {
    endpoint: json.endpoint,
    p256dh: json.keys?.p256dh,
    auth: json.keys?.auth,
  };
}

async function saveSubscriptionToDb(sub) {
  const userId = state.currentUser?.id;
  if (!userId) return { ok: false, message: "Не выполнен вход" };

  const keys = subscriptionKeys(sub);
  if (!keys.endpoint || !keys.p256dh || !keys.auth) {
    return { ok: false, message: "Некорректная подписка" };
  }

  const row = {
    user_id: userId,
    endpoint: keys.endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    user_agent: navigator.userAgent || "",
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseClient
    .from("push_subscriptions")
    .upsert(row, { onConflict: "user_id,endpoint" });

  if (error) {
    console.error("push subscription save:", error);
    return { ok: false, message: "Не удалось сохранить подписку в базе" };
  }
  return { ok: true };
}

async function removeSubscriptionFromDb(endpoint) {
  if (!endpoint) return;
  const { error } = await supabaseClient.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) console.warn("push subscription delete:", error);
}

export async function getPushStatus() {
  if (!isPushSupported()) {
    return { supported: false, permission: "unsupported", subscribed: false };
  }

  const permission = Notification.permission;
  let subscribed = false;
  try {
    const reg = await getServiceWorkerRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    subscribed = Boolean(sub);
  } catch {
    /* ignore */
  }

  return {
    supported: true,
    permission,
    subscribed,
    standalone: isStandalonePwa(),
    ios: isIos(),
  };
}

export async function subscribeToPush() {
  if (!isAdmin()) return { ok: false, message: "Доступно только администраторам" };
  if (!isPushSupported()) return { ok: false, message: "Браузер не поддерживает push-уведомления" };

  if (isIos() && !isStandalonePwa()) {
    return {
      ok: false,
      message:
        "На iPhone сначала добавьте сайт на экран «Домой» (Поделиться → На экран «Домой»), затем откройте приложение с иконки и включите уведомления здесь.",
    };
  }

  const publicKey = await fetchVapidPublicKey();
  if (!publicKey) {
    return { ok: false, message: "Push не настроен на сервере (нет VAPID-ключа)" };
  }

  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }
  if (permission !== "granted") {
    return { ok: false, message: "Разрешение на уведомления не получено" };
  }

  const reg = await getServiceWorkerRegistration();
  if (!reg) return { ok: false, message: "Service Worker не готов" };

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  return saveSubscriptionToDb(sub);
}

export async function unsubscribeFromPush() {
  if (!isPushSupported()) return { ok: false, message: "Push не поддерживается" };

  const reg = await getServiceWorkerRegistration();
  const sub = await reg?.pushManager?.getSubscription();
  if (!sub) return { ok: true };

  const endpoint = sub.endpoint;
  const ok = await sub.unsubscribe();
  if (ok) await removeSubscriptionFromDb(endpoint);
  return { ok };
}

/** Если разрешение уже выдано — синхронизировать подписку с БД без запроса диалога. */
export async function syncPushSubscriptionIfGranted() {
  if (!isAdmin() || !isPushSupported()) return;
  if (Notification.permission !== "granted") return;
  if (isIos() && !isStandalonePwa()) return;

  try {
    const publicKey = await fetchVapidPublicKey();
    if (!publicKey) return;

    const reg = await getServiceWorkerRegistration();
    if (!reg) return;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    await saveSubscriptionToDb(sub);
  } catch (e) {
    console.warn("[push] sync subscription:", e);
  }
}

function setPushUiMessage(text, isError = false) {
  const el = document.getElementById("pushNotificationsMessage");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("push-notifications-message--error", Boolean(isError && text));
}

async function refreshPushSettingsUi() {
  const card = document.getElementById("pushNotificationsCard");
  const btn = document.getElementById("pushNotificationsToggleBtn");
  const hint = document.getElementById("pushNotificationsHint");
  if (!card || !btn) return;

  if (!isAdmin()) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  const status = await getPushStatus();
  if (!status.supported) {
    btn.disabled = true;
    btn.textContent = "Не поддерживается";
    if (hint) {
      hint.textContent = "Этот браузер не поддерживает Web Push.";
    }
    return;
  }

  if (status.ios && !status.standalone && hint) {
    hint.textContent =
      "iPhone: добавьте сайт на экран «Домой», откройте с иконки — тогда можно включить уведомления о новых задачах.";
  } else if (hint) {
    hint.textContent =
      "При создании задачи любым пользователем админам придёт уведомление (как в мессенджере).";
  }

  if (status.subscribed && status.permission === "granted") {
    btn.textContent = "Отключить уведомления";
    btn.dataset.pushAction = "unsubscribe";
    btn.disabled = false;
  } else {
    btn.textContent = "Включить уведомления";
    btn.dataset.pushAction = "subscribe";
    btn.disabled = status.permission === "denied";
    if (status.permission === "denied") {
      setPushUiMessage(
        "Уведомления заблокированы в настройках браузера или iOS. Разрешите их для этого приложения.",
        true,
      );
    }
  }
}

export async function refreshPushNotificationsUi() {
  await refreshPushSettingsUi();
}

/** Сбросить красный кружок на иконке PWA (iOS / Android). */
export async function clearPushBadge() {
  try {
    if (typeof navigator.clearAppBadge === "function") {
      await navigator.clearAppBadge();
    }
    const reg = await navigator.serviceWorker?.ready;
    reg?.active?.postMessage({ type: "clear-badge" });
  } catch (e) {
    console.warn("[push] clear badge:", e);
  }
}

export function initPushNotificationsSection() {
  const btn = document.getElementById("pushNotificationsToggleBtn");
  if (!btn || btn.dataset.pushBound === "1") return;
  btn.dataset.pushBound = "1";

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    setPushUiMessage("");

    const action = btn.dataset.pushAction || "subscribe";
    const result =
      action === "unsubscribe" ? await unsubscribeFromPush() : await subscribeToPush();

    if (!result.ok) {
      setPushUiMessage(result.message || "Не удалось изменить подписку", true);
    } else if (action === "subscribe") {
      setPushUiMessage("Уведомления включены.");
    } else {
      setPushUiMessage("Уведомления отключены.");
    }

    await refreshPushSettingsUi();
  });

  void refreshPushSettingsUi();
}

export async function initPushNotifications() {
  if (!isAdmin()) return;
  initPushNotificationsSection();
  await syncPushSubscriptionIfGranted();
  await refreshPushSettingsUi();
}
