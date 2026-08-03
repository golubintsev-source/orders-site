import { supabaseClient } from "./config.js";
import { state } from "./state.js";

let cachedVapidPublicKey = null;
let deferredInstallPrompt = null;

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent || "");
}

function isDesktopBrowser() {
  return !isIos() && !/Android/i.test(navigator.userAgent || "");
}

function isEdgeBrowser() {
  return /Edg\//i.test(navigator.userAgent || "");
}

function isChromeBrowser() {
  return /Chrome\//i.test(navigator.userAgent || "") && !isEdgeBrowser();
}

function getDesktopInstallHint() {
  if (isEdgeBrowser()) {
    return (
      "Windows + Edge: 1) Посмотрите на адресную строку — если есть значок «+» или «Приложение доступно», нажмите его → Установить. " +
      "2) Или меню ⋯ справа вверху → Приложения → Установить этот сайт как приложение. " +
      "3) Откройте «ФАБРИКА ОКОН» с иконки в меню Пуск и включите уведомления."
    );
  }
  if (isChromeBrowser()) {
    return (
      "Windows + Chrome: 1) Посмотрите на адресную строку — если есть значок «Установить» (⊕), нажмите его. " +
      "2) Или меню ⋯ → Передать, сохранить и поделиться → Установить страницу как приложение. " +
      "3) Откройте «ФАБРИКА ОКОН» с иконки в меню Пуск и включите уведомления."
    );
  }
  return (
    "Установите сайт как приложение через меню браузера (обычно ⋯ → Установить / Приложения), " +
    "затем откройте с иконки в меню Пуск и включите уведомления."
  );
}

async function applyPageBadge(count) {
  const n = Math.max(0, Math.min(count, 99));
  if (n > 0) {
    if ("setAppBadge" in navigator) {
      await navigator.setAppBadge(n);
    } else {
      const reg = await navigator.serviceWorker?.ready;
      if (reg?.setAppBadge) await reg.setAppBadge(n);
    }
    return;
  }
  if ("clearAppBadge" in navigator) {
    await navigator.clearAppBadge();
  } else {
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.clearAppBadge) await reg.clearAppBadge();
  }
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
  if (!isPushSupported()) return;
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
      "iPhone: добавьте сайт на экран «Домой», откройте с иконки — тогда можно включить уведомления о сообщениях и задачах.";
  } else if (!status.standalone && isDesktopBrowser() && hint) {
    hint.textContent = getDesktopInstallHint();
  } else if (hint) {
    hint.textContent =
      "Включите уведомления — при новом сообщении придёт push, как в мессенджере.";
  }

  const installBtn = document.getElementById("pushNotificationsInstallBtn");
  if (installBtn) {
    installBtn.hidden = status.standalone || !isDesktopBrowser();
  }

  if (status.subscribed && status.permission === "granted") {
    btn.textContent = "Уведомления включены";
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

/** Сбросить красный кружок на иконке PWA (iOS / Windows / Android). */
export async function clearPushBadge() {
  try {
    await applyPageBadge(0);
    const reg = await navigator.serviceWorker?.ready;
    reg?.active?.postMessage({ type: "clear-badge" });
  } catch (e) {
    console.warn("[push] clear badge:", e);
  }
}

/** Восстановить счётчик на иконке из service worker (актуально для Windows PWA). */
export async function syncPushBadgeFromServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.active) return;

    const count = await new Promise((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => resolve(0), 1500);
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        resolve(Number(event.data?.count) || 0);
      };
      reg.active.postMessage({ type: "get-badge-count" }, [channel.port2]);
    });

    if (count > 0) await applyPageBadge(count);
  } catch (e) {
    console.warn("[push] sync badge:", e);
  }
}

function initPwaInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    void refreshPushSettingsUi();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    void refreshPushSettingsUi();
  });

  const installBtn = document.getElementById("pushNotificationsInstallBtn");
  if (!installBtn || installBtn.dataset.pushInstallBound === "1") return;
  installBtn.dataset.pushInstallBound = "1";

  installBtn.addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      setPushUiMessage(getDesktopInstallHint(), true);
      return;
    }
    installBtn.disabled = true;
    try {
      await deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      if (outcome === "accepted") {
        setPushUiMessage("Приложение установлено. Откройте его с иконки и включите уведомления.");
      }
    } catch (e) {
      console.warn("[push] install prompt:", e);
      setPushUiMessage("Не удалось открыть установку. Используйте меню браузера.", true);
    } finally {
      installBtn.disabled = false;
      await refreshPushSettingsUi();
    }
  });
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
  initPwaInstallPrompt();
  initPushNotificationsSection();
  await syncPushSubscriptionIfGranted();
  await syncPushBadgeFromServiceWorker();
  await refreshPushSettingsUi();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void syncPushBadgeFromServiceWorker();
    }
  });
}
