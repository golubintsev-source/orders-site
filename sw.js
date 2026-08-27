/* eslint-disable no-restricted-globals */
/**
 * Service worker: push/badge + кэш статики (JS/CSS/иконки) для быстрого открытия PWA.
 * HTML и JS — stale-while-revalidate: оболочка рисуется из кэша без сетевого round-trip,
 * свежая версия подтягивается в фоне и применяется со следующего запуска. Раньше HTML был
 * network-first, и на iPhone каждый холодный старт PWA ждал сеть до первого пикселя
 * (плюс это давало рассинхрон: свежий HTML со скриптами из кэша).
 * API не кэшируем.
 */
const BADGE_CACHE = "orders-site-badge-v1";
// v43: push не глушится по устаревшему статусу видимости, подписка переживает ротацию.
const STATIC_CACHE = "orders-site-static-v43";
const BADGE_COUNT_KEY = "/badge-count";
const SHELL_UPDATED_KEY = "/shell-updated";
/** Ключ снимка видимости из прежних версий — больше не используется, чистим при активации. */
const LEGACY_CHAT_VISIBILITY_KEY = "/chat-visibility";

const LEGACY_CACHE_PREFIXES = ["orders-site-static-"];

const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/style.css",
  "/js/chat-boot.js",
  "/js/vendor/supabase.js",
  "/js/boot-route.js",
  "/js/main.js",
  "/js/config.js",
  "/js/state.js",
  "/js/auth.js",
  "/js/orders.js",
  "/js/offline-cache.js",
  "/js/dom.js",
  "/js/ui.js",
  "/js/cell-tooltip.js",
  "/js/section-nav.js",
  "/js/app-routes.js",
  "/js/settings.js",
  "/js/roles.js",
  "/js/files.js",
  "/js/manager-salary.js",
  "/js/debts.js",
  "/js/debts-matrix.js",
  "/js/register-sw.js",
  // Раздел «Чаты» открывают чаще всего — держим его модули готовыми к первому кадру.
  "/js/messages.js",
  "/js/messages-body.js",
  "/js/messages-sync-utils.js",
  "/js/format.js",
  "/js/user-names.js",
  "/js/supabase-fetch.js",
  "/manifest.webmanifest",
  "/img/icon-192.png?v=20260803",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const res = await fetch(url, { cache: "reload" });
            if (res.ok) await cache.put(url, res.clone());
          } catch {
            /* ignore individual precache failures */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (k) =>
              k !== BADGE_CACHE &&
              k !== STATIC_CACHE &&
              LEGACY_CACHE_PREFIXES.some((p) => k.startsWith(p)),
          )
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
      try {
        await (await caches.open(BADGE_CACHE)).delete(LEGACY_CHAT_VISIBILITY_KEY);
      } catch {
        /* ignore */
      }
      // После смены STATIC_CACHE старый JS мог остаться в памяти вкладки —
      // всегда просим оболочку перезагрузиться.
      await notifyShellUpdated();
      const count = await getBadgeCount();
      if (count > 0) await applyAppBadge(count);
    })(),
  );
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isApiPath(pathname) {
  return pathname.startsWith("/api/");
}

function isStaticAsset(url) {
  const p = url.pathname;
  if (p.startsWith("/js/") || p.startsWith("/img/")) return true;
  if (p === "/style.css" || p.endsWith(".css")) return true;
  if (p.endsWith(".webmanifest") || p.endsWith(".woff2") || p.endsWith(".woff")) return true;
  return false;
}

function isNavigationRequest(request) {
  if (request.mode === "navigate") return true;
  const accept = request.headers.get("accept") || "";
  return accept.includes("text/html");
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((res) => {
      if (res && res.ok) {
        void cache.put(request, res.clone());
      }
      return res;
    })
    .catch(() => null);

  if (cached) {
    void networkPromise;
    return cached;
  }
  const network = await networkPromise;
  if (network) return network;
  return new Response("Offline", { status: 503, statusText: "Offline" });
}

/** Пути, которые vercel.json переписывает на index.html (см. rewrites). */
const APP_SHELL_PATHS = new Set([
  "/",
  "/all",
  "/new",
  "/calculations",
  "/excess",
  "/tasks-all",
  "/changes-all",
  "/balance",
  "/manager-salary",
  "/route-sheet",
  "/settings",
  "/statistics",
  "/statistics-balance",
  "/debts",
  "/order-tasks",
  "/messages",
  "/voice",
]);

/** Отдельные страницы (login.html, history.html…) — не оболочка SPA. */
function isAppShellNavigation(url) {
  let p = url.pathname.replace(/\/index\.html$/i, "") || "/";
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return APP_SHELL_PATHS.has(p);
}

/**
 * Оболочка приложения. Все её маршруты отдают один и тот же index.html,
 * поэтому кэш-ключ общий — иначе каждый раздел ждал бы собственный ответ сети.
 */
async function staleWhileRevalidateShell(request, event) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = (await cache.match("/index.html")) || (await cache.match("/"));
  // Клон снимаем до отдачи странице: после этого тело ответа уже читается браузером.
  const cachedText = cached ? await cached.clone().text() : null;

  const networkPromise = fetch(request)
    .then(async (res) => {
      if (!res || !res.ok) return res;
      const freshText = await res.clone().text();
      await cache.put("/", res.clone());
      await cache.put("/index.html", res.clone());
      if (cachedText != null && freshText !== cachedText) await notifyShellUpdated();
      return res;
    })
    .catch(() => null);

  if (cached) {
    // Без waitUntil обновление кэша может не успеть до остановки worker'а.
    event?.waitUntil(networkPromise);
    return cached;
  }

  const network = await networkPromise;
  if (network) return network;
  return offlineNavigationResponse();
}

/**
 * Страница показана из кэша, а на сервере уже другая версия — см. js/register-sw.js.
 * Фоновая проверка часто заканчивается раньше, чем страница успеет подписаться на
 * сообщения, поэтому факт обновления ещё и запоминается до запроса клиента.
 */
async function notifyShellUpdated() {
  const cache = await caches.open(BADGE_CACHE);
  await cache.put(SHELL_UPDATED_KEY, new Response("1"));
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({ type: "shell-updated" });
  }
}

/** Читает и сразу гасит флаг: перезагрузка нужна ровно один раз. */
async function consumeShellUpdatedFlag() {
  try {
    const cache = await caches.open(BADGE_CACHE);
    const hit = await cache.match(SHELL_UPDATED_KEY);
    if (!hit) return false;
    await cache.delete(SHELL_UPDATED_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Остальные HTML-страницы остаются network-first: они открываются редко. */
async function networkFirstNavigate(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok) void cache.put(request, res.clone());
    return res;
  } catch {
    const fallback = await cache.match(request);
    if (fallback) return fallback;
    return offlineNavigationResponse();
  }
}

function offlineNavigationResponse() {
  return new Response("Нет сети", {
    status: 503,
    statusText: "Offline",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (!isSameOrigin(url) || isApiPath(url.pathname)) return;

  if (isStaticAsset(url)) {
    // JS в PWA: не ждём сеть при нестабильном соединении (особенно на iOS/WebView),
    // иначе динамические import'ы могут "залипать" до таймаутов браузера.
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (isNavigationRequest(request)) {
    event.respondWith(
      isAppShellNavigation(url)
        ? staleWhileRevalidateShell(request, event)
        : networkFirstNavigate(request),
    );
  }
});

async function getBadgeCount() {
  try {
    const cache = await caches.open(BADGE_CACHE);
    const res = await cache.match(BADGE_COUNT_KEY);
    if (!res) return 0;
    const n = parseInt(await res.text(), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

async function applyAppBadge(n) {
  // iOS/WebKit: Badging API в SW только на navigator (не на registration).
  if (n > 0) {
    if ("setAppBadge" in self.navigator) {
      await self.navigator.setAppBadge(n);
    } else if (self.registration?.setAppBadge) {
      await self.registration.setAppBadge(n);
    }
    return;
  }
  if ("clearAppBadge" in self.navigator) {
    await self.navigator.clearAppBadge();
  } else if (self.registration?.clearAppBadge) {
    await self.registration.clearAppBadge();
  }
}

async function setBadgeCount(count) {
  const n = Math.max(0, Math.min(count, 99));
  try {
    const cache = await caches.open(BADGE_CACHE);
    if (n > 0) {
      await cache.put(BADGE_COUNT_KEY, new Response(String(n)));
    } else {
      await cache.delete(BADGE_COUNT_KEY);
    }
    await applyAppBadge(n);
  } catch (e) {
    console.warn("[sw] badge:", e);
  }
}

async function incrementBadge() {
  await setBadgeCount((await getBadgeCount()) + 1);
}

async function clearBadge() {
  await setBadgeCount(0);
}

/**
 * Ответ вкладки живёт считаные секунды: перед показом push мы спрашиваем окна заново.
 * Замороженная вкладка (свёрнутое PWA на iPhone) ответить не успеет — и уведомление
 * будет показано. Раньше здесь лежал снимок на 90 секунд, который переживал закрытие
 * приложения и молча глотал уведомления из последнего открытого чата.
 */
const CHAT_VISIBILITY_ANSWER_MAX_AGE_MS = 3_000;
/** Сколько ждём ответы окон, прежде чем решить про баннер. */
const CHAT_VISIBILITY_QUERY_TIMEOUT_MS = 600;
/** @type {Map<string, { visible: boolean, focused: boolean, peerId: string|null, at: number }>} */
const chatVisibilityByClientId = new Map();

function rememberChatVisibility(clientId, data) {
  if (!clientId) return;
  chatVisibilityByClientId.set(String(clientId), {
    visible: Boolean(data?.visible),
    focused: Boolean(data?.focused),
    peerId: data?.peerId ? String(data.peerId) : null,
    at: Date.now(),
  });
}

function forgetClosedClients(clientList) {
  const live = new Set(clientList.map((client) => String(client.id)));
  for (const clientId of [...chatVisibilityByClientId.keys()]) {
    if (!live.has(clientId)) chatVisibilityByClientId.delete(clientId);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Спрашиваем живые окна, что у них на экране прямо сейчас. */
async function collectChatVisibility(clientList) {
  forgetClosedClients(clientList);
  if (!clientList.length) return [];
  for (const client of clientList) {
    try {
      client.postMessage({ type: "chat-visibility-query" });
    } catch {
      /* ignore */
    }
  }
  await delay(CHAT_VISIBILITY_QUERY_TIMEOUT_MS);
  return [...chatVisibilityByClientId.values()];
}

/** Дублирует resolvePushSuppression из js/messages-sync-utils.js: sw.js не модуль. */
function shouldSuppressPushForPeer(incomingPeer, states) {
  if (!incomingPeer) return false;
  const now = Date.now();
  for (const state of states) {
    if (now - Number(state?.at || 0) > CHAT_VISIBILITY_ANSWER_MAX_AGE_MS) continue;
    if (!state?.visible) continue;
    if (state.peerId && String(state.peerId) === String(incomingPeer)) return true;
  }
  return false;
}

function pluralRu(n, one, few, many) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** Дублирует notificationBodyWithCount из js/messages-sync-utils.js. */
function notificationBodyWithCount(text, count) {
  const body = String(text || "").trim();
  const extra = Math.max(0, Math.floor(Number(count) || 0) - 1);
  if (!extra) return body;
  const suffix = `Ещё ${extra} ${pluralRu(extra, "сообщение", "сообщения", "сообщений")}`;
  return body ? `${body}\n${suffix}` : suffix;
}

/** Сколько сообщений уже висит в баннере этого чата — чтобы схлопнуть их в один счётчик. */
async function pendingNotificationCount(tag) {
  try {
    const existing = await self.registration.getNotifications({ tag });
    let count = 0;
    for (const note of existing) count += Math.max(1, Number(note.data?.count) || 1);
    return count;
  } catch {
    return 0;
  }
}

function incomingPeerFromPushData(data) {
  if (data?.peerId) return String(data.peerId);
  if (data?.chatId) {
    const id = String(data.chatId);
    return id.startsWith("group:") ? id : `group:${id}`;
  }
  try {
    const u = new URL(data?.url || "/messages", self.location.origin);
    return u.searchParams.get("chat");
  } catch {
    return null;
  }
}

function clientViewsIncomingChat(client, incomingPeer) {
  if (!incomingPeer || !client) return false;
  // Только visibilityState: WindowClient.focused на iOS остаётся true у свёрнутого PWA,
  // и уведомление о новом сообщении пропадало.
  if (client.visibilityState !== "visible") return false;
  try {
    const u = new URL(client.url);
    const chat = u.searchParams.get("chat");
    return Boolean(chat && chat === String(incomingPeer));
  } catch {
    return false;
  }
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "chat-visibility") {
    rememberChatVisibility(event.source?.id || "page", event.data);
    return;
  }
  if (event.data?.type === "clear-badge") {
    event.waitUntil(clearBadge());
    return;
  }
  if (event.data?.type === "set-badge-count") {
    event.waitUntil(setBadgeCount(Number(event.data.count) || 0));
    return;
  }
  if (event.data?.type === "get-shell-updated") {
    event.waitUntil(
      (async () => {
        event.ports[0]?.postMessage({ updated: await consumeShellUpdatedFlag() });
      })(),
    );
    return;
  }
  if (event.data?.type === "get-badge-count") {
    event.waitUntil(
      (async () => {
        const count = await getBadgeCount();
        event.ports[0]?.postMessage({ count });
        if (count > 0) await applyAppBadge(count);
      })(),
    );
  }
});

self.addEventListener("push", (event) => {
  let data = {
    title: "ФАБРИКА ОКОН",
    body: "Новое уведомление",
    url: "/messages",
    tag: "orders-site",
  };
  try {
    if (event.data) {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    }
  } catch (_) {
    /* ignore malformed payload */
  }

  event.waitUntil(
    (async () => {
      const incomingPeer = incomingPeerFromPushData(data);
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of clientList) {
        client.postMessage({
          type: "push-received",
          payload: data,
          peerId: incomingPeer,
          chatId: data.chatId || null,
          url: data.url || "/messages",
        });
      }

      const states = await collectChatVisibility(clientList);
      let suppress = shouldSuppressPushForPeer(incomingPeer, states);
      if (!suppress) {
        suppress = clientList.some((client) => clientViewsIncomingChat(client, incomingPeer));
      }
      if (suppress) return;

      const tag = data.tag || (incomingPeer ? `chat-${incomingPeer}` : "orders-site");
      const count = (await pendingNotificationCount(tag)) + 1;
      const options = {
        body: notificationBodyWithCount(data.body || "Новое уведомление", count),
        icon: "/img/icon-192.png?v=20260803",
        badge: "/img/icon-192.png?v=20260803",
        tag,
        renotify: true,
        timestamp: Date.now(),
        data: {
          url: data.url || "/messages",
          peerId: incomingPeer,
          chatId: data.chatId || null,
          messageId: data.messageId || null,
          count,
        },
      };

      await Promise.all([
        setBadgeCount((await getBadgeCount()) + 1),
        self.registration.showNotification(data.title || "ФАБРИКА ОКОН", options),
      ]);
    })(),
  );
});

/**
 * Браузер периодически перевыпускает подписку (и сам гасит старую). Без обмена
 * endpoint'ов сервер получает 410, удаляет строку — и push молча пропадают до
 * следующего открытия приложения.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const oldEndpoint = event.oldSubscription?.endpoint || null;
      try {
        let subscription = event.newSubscription || null;
        if (!subscription) {
          subscription = await self.registration.pushManager.getSubscription();
        }
        if (!subscription) {
          const applicationServerKey =
            event.oldSubscription?.options?.applicationServerKey ||
            (await fetchApplicationServerKey());
          if (!applicationServerKey) return;
          subscription = await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey,
          });
        }
        const json = subscription.toJSON();
        if (!json?.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;
        await fetch("/api/push-subscription-rotate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oldEndpoint, subscription: json }),
        });
      } catch (e) {
        console.warn("[sw] pushsubscriptionchange:", e);
      }
    })(),
  );
});

function base64UrlToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function fetchApplicationServerKey() {
  try {
    const res = await fetch("/api/push-config");
    if (!res.ok) return null;
    const data = await res.json();
    return data?.publicKey ? base64UrlToUint8Array(data.publicKey) : null;
  } catch {
    return null;
  }
}

/** Оболочка SPA сама разведёт маршрут по postMessage; отдельные страницы — нет. */
function clientCanRouteInPlace(client) {
  try {
    return isAppShellNavigation(new URL(client.url));
  } catch {
    return false;
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const noteData = event.notification.data || {};
  const relUrl = noteData.url || "/messages";
  const targetUrl = new URL(relUrl, self.location.origin).href;
  const peerId = noteData.peerId || incomingPeerFromPushData(noteData);

  event.waitUntil(
    (async () => {
      // Остальные баннеры этого чата уже не нужны. Счётчик на иконке не трогаем:
      // приложение сейчас откроется и пересчитает непрочитанные по базе.
      await closeNotificationsForPeer(peerId, event.notification.tag);

      const clients = (
        await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      ).filter((client) => client.url.startsWith(self.location.origin));

      // Видимое окно перехватывает клик: иначе на Windows фокус уходит в свёрнутую вкладку.
      const target =
        clients.find((client) => client.visibilityState === "visible" || client.focused) ||
        clients[0];

      if (target) {
        target.postMessage({
          type: "open-chat",
          url: relUrl,
          peerId,
          chatId: noteData.chatId || null,
        });
        if (!clientCanRouteInPlace(target) && typeof target.navigate === "function") {
          try {
            const navigated = await target.navigate(targetUrl);
            if (navigated && "focus" in navigated) return navigated.focus();
          } catch {
            /* переход запрещён — остаётся обычный фокус */
          }
        }
        if ("focus" in target) return target.focus();
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })(),
  );
});

/** Смахнули баннер — на иконке не должно оставаться этих сообщений. */
self.addEventListener("notificationclose", (event) => {
  const count = Math.max(1, Number(event.notification.data?.count) || 1);
  event.waitUntil(
    (async () => {
      await setBadgeCount(Math.max(0, (await getBadgeCount()) - count));
    })(),
  );
});

async function closeNotificationsForPeer(peerId, tag) {
  try {
    const notes = await self.registration.getNotifications();
    for (const note of notes) {
      const notePeer = note.data?.peerId || incomingPeerFromPushData(note.data || {});
      if ((peerId && notePeer === peerId) || (tag && note.tag === tag)) note.close();
    }
  } catch {
    /* ignore */
  }
}
