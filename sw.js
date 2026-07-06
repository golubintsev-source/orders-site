/* eslint-disable no-restricted-globals */
/**
 * Service worker: push-уведомления и badge.
 * Статику и API не перехватывает — страница всегда грузится с сервера без задержек кэша.
 */
const BADGE_CACHE = "orders-site-badge-v1";
const BADGE_COUNT_KEY = "/badge-count";

const LEGACY_CACHE_PREFIXES = ["orders-site-static-"];

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== BADGE_CACHE && LEGACY_CACHE_PREFIXES.some((p) => k.startsWith(p)))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
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

self.addEventListener("message", (event) => {
  if (event.data?.type === "clear-badge") {
    event.waitUntil(clearBadge());
  }
});

self.addEventListener("push", (event) => {
  let data = {
    title: "Заявки",
    body: "Новая задача",
    url: "/tasks-all",
    tag: "new-task",
  };
  try {
    if (event.data) {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    }
  } catch (_) {
    /* ignore malformed payload */
  }

  const options = {
    body: data.body || "Новая задача",
    icon: "/img/icon-192.png",
    badge: "/img/icon-192.png",
    tag: data.tag || "new-task",
    data: { url: data.url || "/tasks-all" },
    renotify: true,
  };

  event.waitUntil(
    (async () => {
      const count = (await getBadgeCount()) + 1;
      await Promise.all([
        setBadgeCount(count),
        self.registration.showNotification(data.title || "Заявки", options),
      ]);
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const relUrl = event.notification.data?.url || "/tasks-all";
  const targetUrl = new URL(relUrl, self.location.origin).href;

  event.waitUntil(
    (async () => {
      await clearBadge();
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        if (!client.url.startsWith(self.location.origin)) continue;
        if ("focus" in client) {
          if (typeof client.navigate === "function") {
            await client.navigate(targetUrl);
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })(),
  );
});
