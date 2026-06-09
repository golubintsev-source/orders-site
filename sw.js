/* eslint-disable no-restricted-globals */
/**
 * Офлайн-оболочка: после хотя бы одного онлайн-визита F5 без сети отдаёт кэш
 * (HTML, JS, CSS, изображения, CDN-скрипты из index/login/calculations/history).
 * Увеличьте CACHE_STATIC при изменении списка или критичных ассетов.
 */
const CACHE_STATIC = "orders-site-static-v2";

const CDN_URLS = [
  "https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.min.css",
  "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css",
  "https://cdn.jsdelivr.net/npm/blueimp-load-image@5.16.0/js/load-image.all.min.js",
  "https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.min.js",
  "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js",
  "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js",
  "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js",
  "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
];

const JS_FILES = [
  "all-changes.js",
  "app-routes.js",
  "auth.js",
  "balance.js",
  "boot-route.js",
  "calculations.js",
  "calculationsExcelExport.js",
  "clientAutocomplete.js",
  "config.js",
  "db-ping.js",
  "dbHealth.js",
  "dom.js",
  "files.js",
  "format.js",
  "history.js",
  "login-page.js",
  "main.js",
  "motivationQuotes.js",
  "offline-cache.js",
  "orders.js",
  "ordersExcelExport.js",
  "ordersTableMobileFit.js",
  "ordersTablePinchZoom.js",
  "ordersTableStickyHeader.js",
  "roles.js",
  "route-sheet.js",
  "section-nav.js",
  "settings.js",
  "state.js",
  "tasks.js",
  "ui.js",
  "windowCalcPage.js",
  "windowCalculator.js",
  "windowGridSchema.js",
  "windowSystemKbe.js",
  "xlsxDownload.js",
];

function originUrls() {
  const o = self.location.origin;
  const paths = [
    "/",
    "/index.html",
    "/login.html",
    "/calculations.html",
    "/history.html",
    "/window-calculations.html",
    "/style.css",
    "/img/logo.png",
    "/img/calculator.svg",
    "/img/window-calculations-link.svg",
    "/img/search-magnifier.svg",
    "/images/yandex-maps-pin.png",
    "/js/register-sw.js",
    "/sw.js",
  ];
  for (const f of JS_FILES) {
    paths.push(`/js/${f}`);
  }
  const main = `${o}/js/main.js?v=28`;
  return { all: [...paths.map((p) => o + p), main], mainPrecache: main };
}

async function putOrIgnore(cache, url) {
  try {
    const req = new Request(url, { cache: "reload" });
    const res = await fetch(req);
    if (res.ok) await cache.put(url, res);
  } catch (e) {
    console.warn("[sw] precache skip:", url, e);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_STATIC);
      const { all, mainPrecache } = originUrls();
      const urls = [...new Set([...all, mainPrecache, ...CDN_URLS])];
      await Promise.all(urls.map((u) => putOrIgnore(cache, u)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_STATIC).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function shouldRuntimeCacheGet(url) {
  if (isSameOrigin(url) && url.pathname.startsWith("/api/")) return false;
  const p = url.pathname;
  if (isSameOrigin(url)) {
    return (
      p.endsWith(".html") ||
      p.endsWith(".js") ||
      p.endsWith(".css") ||
      p.endsWith(".png") ||
      p.endsWith(".svg") ||
      p.endsWith(".ico") ||
      p.endsWith(".woff2") ||
      p === "/" ||
      /^\/(new|calculations|tasks-all|changes-all|balance|route-sheet|settings|order-tasks|all)(\/)?$/.test(
        url.pathname
      )
    );
  }
  return isCdnUrl(url);
}

function isCdnUrl(url) {
  if (url.hostname.includes("cdn.jsdelivr.net")) return true;
  if (url.hostname.includes("cdn.sheetjs.com")) return true;
  return false;
}

async function cacheMatchLoose(cache, request) {
  let r = await cache.match(request);
  if (r) return r;
  r = await cache.match(request, { ignoreSearch: true });
  if (r) return r;
  const u = new URL(request.url);
  if (u.origin === self.location.origin && u.pathname.endsWith(".js")) {
    const bare = `${u.origin}${u.pathname}`;
    r = await cache.match(bare);
  }
  return r || null;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  if (isSameOrigin(url) && url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(req).catch(
        () =>
          new Response(JSON.stringify({ error: "offline", message: "Нет сети" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          })
      )
    );
    return;
  }

  if (!shouldRuntimeCacheGet(url) && !CDN_URLS.includes(req.url)) {
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_STATIC);
      try {
        const networkRes = await fetch(req);
        if (networkRes.ok && shouldRuntimeCacheGet(url)) {
          try {
            await cache.put(req, networkRes.clone());
          } catch (_) {
            /* ignore quota / opaque */
          }
        }
        return networkRes;
      } catch {
        let cached = await cacheMatchLoose(cache, req);
        if (cached) return cached;

        if (req.mode === "navigate") {
          const fallbacks = [
            self.location.origin + "/index.html",
            self.location.origin + "/",
            self.location.origin + "/login.html",
            self.location.origin + "/calculations.html",
            self.location.origin + "/history.html",
            self.location.origin + "/window-calculations.html",
          ];
          for (const fb of fallbacks) {
            cached = await cache.match(fb);
            if (cached) return cached;
          }
        }
        return new Response("Нет сети и нет копии в кэше сервис-воркера. Откройте сайт онлайн один раз.", {
          status: 503,
          statusText: "Offline",
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    })()
  );
});
