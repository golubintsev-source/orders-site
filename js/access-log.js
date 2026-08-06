import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import { isOfflineDataMode } from "./offline-cache.js";
import { buildPagePathForSection, normalizeAccessLogPath } from "./app-routes.js";
import { isDbPingIndicatingOffline } from "./db-ping.js";

const GEO_CACHE_KEY = "orders_site_access_geo_v1";
const PENDING_LOGS_KEY = "orders_site_pending_access_logs_v1";
/** Максимум отложенных обращений в localStorage (раньше 50 — терялись при офлайне). */
const PENDING_LOGS_MAX = 200;

let geoCachePromise = null;
let sectionSwitchStartedAt = null;
let flushPendingPromise = null;
/** Уникальные id текущих записей (не блокируем повторный путь). */
const inFlightLogIds = new Set();
let nextLogFlightId = 1;

function readJsonStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function detectOsFromUa(ua) {
  const s = ua || "";
  const win = s.match(/Windows NT ([\d.]+)/i);
  if (win) {
    const ver = win[1];
    const map = { "10.0": "10/11", "6.3": "8.1", "6.2": "8", "6.1": "7", "6.0": "Vista", "5.1": "XP" };
    return { osName: "Windows", osVersion: map[ver] || ver };
  }
  const mac = s.match(/Mac OS X ([\d_]+)/i);
  if (mac) {
    return { osName: "macOS", osVersion: mac[1].replace(/_/g, ".") };
  }
  const android = s.match(/Android ([\d.]+)/i);
  if (android) {
    return { osName: "Android", osVersion: android[1] };
  }
  const ios = s.match(/(?:iPhone OS|CPU OS) ([\d_]+)/i);
  if (ios) {
    return { osName: "iOS", osVersion: ios[1].replace(/_/g, ".") };
  }
  if (/CrOS/i.test(s)) return { osName: "Chrome OS", osVersion: "" };
  if (/Linux/i.test(s)) return { osName: "Linux", osVersion: "" };
  return { osName: "Unknown", osVersion: "" };
}

function detectDeviceType(ua, mobileHint) {
  const s = ua || "";
  if (mobileHint === true) return "mobile";
  if (mobileHint === false && /iPad|Tablet/i.test(s)) return "tablet";
  if (/iPad|Tablet|PlayBook|Silk/i.test(s)) return "tablet";
  if (/Mobi|Android.+Mobile|iPhone|iPod|Windows Phone/i.test(s)) return "mobile";
  return "desktop";
}

function detectDeviceName(ua) {
  const s = ua || "";
  if (/iPhone/i.test(s)) return "iPhone";
  if (/iPad/i.test(s)) return "iPad";
  if (/Macintosh/i.test(s)) return "Mac";
  if (/Android/i.test(s)) {
    const m = s.match(/;\s*([^;)]+)\s+Build\//i);
    return m ? m[1].trim() : "Android";
  }
  if (/Windows/i.test(s)) return "Windows PC";
  if (/Linux/i.test(s)) return "Linux PC";
  return "";
}

async function collectDeviceInfo() {
  const ua = navigator.userAgent || "";
  let mobileHint = null;
  let platform = "";
  let platformVersion = "";
  let model = "";

  if (navigator.userAgentData?.getHighEntropyValues) {
    try {
      const hintsPromise = navigator.userAgentData.getHighEntropyValues([
        "platform",
        "platformVersion",
        "model",
        "mobile",
      ]);
      const hints = await Promise.race([
        hintsPromise,
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("ua timeout")), 1500);
        }),
      ]);
      mobileHint = hints.mobile;
      platform = hints.platform || "";
      platformVersion = hints.platformVersion || "";
      model = hints.model || "";
    } catch {
      /* ignore */
    }
  }

  let osName;
  let osVersion;
  if (platform) {
    osName = platform;
    osVersion = platformVersion;
  } else {
    const parsed = detectOsFromUa(ua);
    osName = parsed.osName;
    osVersion = parsed.osVersion;
  }

  return {
    deviceType: detectDeviceType(ua, mobileHint),
    deviceName: model || detectDeviceName(ua),
    osName,
    osVersion,
  };
}

async function fetchGeoInfo() {
  const cached = readJsonStorage(GEO_CACHE_KEY, null);
  if (cached?.at && Date.now() - cached.at < 30 * 60 * 1000) {
    return cached.data;
  }

  if (!geoCachePromise) {
    geoCachePromise = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      try {
        const res = await fetch("https://ipwho.is/", { signal: controller.signal });
        if (!res.ok) throw new Error(`geo http ${res.status}`);
        const data = await res.json();
        if (!data?.success) throw new Error("geo api failed");
        const info = {
          city: data.city || null,
          country: data.country || null,
          vpnDetected: Boolean(
            data.security?.vpn || data.security?.proxy || data.security?.tor || data.security?.relay,
          ),
        };
        writeJsonStorage(GEO_CACHE_KEY, { at: Date.now(), data: info });
        return info;
      } catch {
        return { city: null, country: null, vpnDetected: null };
      } finally {
        clearTimeout(timer);
        geoCachePromise = null;
      }
    })();
  }

  return geoCachePromise;
}

const EMPTY_GEO = { city: null, country: null, vpnDetected: null };

async function collectAccessContext() {
  const [device, geo] = await Promise.all([
    collectDeviceInfo(),
    Promise.race([
      fetchGeoInfo(),
      new Promise((resolve) => {
        setTimeout(() => resolve(EMPTY_GEO), 3000);
      }),
    ]),
  ]);
  return { device, geo };
}

export function getCurrentPagePath() {
  const { pathname, search, hash } = window.location;
  return `${pathname || "/"}${search || ""}${hash || ""}`;
}

export function measureNavigationResponseMs() {
  const nav = performance.getEntriesByType("navigation")[0];
  if (nav && nav.domInteractive > 0 && nav.fetchStart >= 0) {
    return Math.max(0, Math.round(nav.domInteractive - nav.fetchStart));
  }
  if (document.readyState === "complete" && performance.timing?.domInteractive) {
    const t = performance.timing;
    return Math.max(0, t.domInteractive - t.fetchStart);
  }
  return null;
}

export function markSectionSwitchStart() {
  sectionSwitchStartedAt = performance.now();
}

export function consumeSectionSwitchMs() {
  if (sectionSwitchStartedAt == null) return null;
  const ms = Math.round(performance.now() - sectionSwitchStartedAt);
  sectionSwitchStartedAt = null;
  return Math.max(0, ms);
}

export function measureAfterPaint(callback) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => callback());
  });
}

function isUiShowingDbOffline() {
  const banner = document.getElementById("dbUnavailableBanner");
  if (banner && !banner.hidden) return true;
  const ping = document.getElementById("dbPingIndicator");
  if (ping?.classList.contains("db-ping-indicator--error")) return true;
  return false;
}

function getWorkMode() {
  if (isOfflineDataMode()) return "offline";
  if (isDbPingIndicatingOffline()) return "offline";
  if (isUiShowingDbOffline()) return "offline";
  return "online";
}

function queuePendingLog(row) {
  const list = readJsonStorage(PENDING_LOGS_KEY, []);
  list.push({ ...row, queuedAt: new Date().toISOString() });
  writeJsonStorage(PENDING_LOGS_KEY, list.slice(-PENDING_LOGS_MAX));
}

/** Только колонки таблицы site_access_logs (без служебных visited_at / queuedAt). */
function toDbInsertPayload(row, user) {
  const pagePath = normalizeAccessLogPath(row.page_path);
  const payload = {
    user_id: user?.id ?? row.user_id ?? null,
    user_email: user?.email || row.user_email || null,
    page_path: pagePath,
    page_title: row.page_title ?? null,
    device_type: row.device_type ?? null,
    device_name: row.device_name ?? null,
    os_name: row.os_name ?? null,
    os_version: row.os_version ?? null,
    city: row.city ?? null,
    country: row.country ?? null,
    vpn_detected: row.vpn_detected ?? null,
    response_time_ms: row.response_time_ms ?? null,
    work_mode: row.work_mode === "offline" ? "offline" : "online",
  };
  const visitedAt = row.visited_at || row.queuedAt || row.created_at;
  if (visitedAt) payload.created_at = visitedAt;
  return payload;
}

async function insertAccessLog(row) {
  const { error } = await supabaseClient.from("site_access_logs").insert(row);
  if (error) throw error;
}

export async function flushPendingAccessLogs(user = state.currentUser) {
  if (!user?.id) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  if (flushPendingPromise) return flushPendingPromise;

  flushPendingPromise = (async () => {
    const list = readJsonStorage(PENDING_LOGS_KEY, []);
    if (!list.length) return;

    // Сразу забираем очередь из storage — параллельные flush не продублируют записи.
    writeJsonStorage(PENDING_LOGS_KEY, []);

    const remaining = [];
    for (const item of list) {
      try {
        await insertAccessLog(toDbInsertPayload(item, user));
      } catch (e) {
        console.warn("Не удалось отправить отложенный лог обращения:", e);
        remaining.push(item);
      }
    }

    if (remaining.length) {
      const existing = readJsonStorage(PENDING_LOGS_KEY, []);
      writeJsonStorage(PENDING_LOGS_KEY, [...remaining, ...existing].slice(-PENDING_LOGS_MAX));
    }
  })().finally(() => {
    flushPendingPromise = null;
  });

  return flushPendingPromise;
}

/**
 * Записать обращение к странице/разделу в site_access_logs.
 * Каждое обращение — отдельная строка (без дедупликации по пути за 10 с).
 * @param {{ pagePath?: string, pageTitle?: string, responseTimeMs?: number|null, user?: object|null, force?: boolean, workMode?: string }} opts
 */
export async function logSiteAccess(opts = {}) {
  const pagePath = normalizeAccessLogPath(opts.pagePath || getCurrentPagePath());
  const flightId = nextLogFlightId++;
  inFlightLogIds.add(flightId);

  // Режим фиксируем сразу; после await перепроверяем (пинг БД мог стать красным).
  const workModeAtStart = opts.workMode ?? getWorkMode();
  const visitedAt = new Date().toISOString();

  try {
    const user = opts.user ?? state.currentUser ?? null;
    const { device, geo } = await collectAccessContext();

    const workMode =
      workModeAtStart === "offline" || getWorkMode() === "offline" ? "offline" : "online";

    const row = {
      user_id: user?.id ?? null,
      user_email: user?.email ?? null,
      page_path: pagePath,
      page_title: opts.pageTitle ?? document.title ?? null,
      device_type: device.deviceType,
      device_name: device.deviceName || null,
      os_name: device.osName || null,
      os_version: device.osVersion || null,
      city: geo.city,
      country: geo.country,
      vpn_detected: geo.vpnDetected,
      response_time_ms: opts.responseTimeMs ?? null,
      work_mode: workMode,
      visited_at: visitedAt,
    };

    if (!user?.id) {
      queuePendingLog(row);
      return;
    }

    // В офлайне не пишем в БД сразу: иначе insert может пройти при navigator.onLine === true.
    if (
      workMode === "offline" ||
      (typeof navigator !== "undefined" && navigator.onLine === false)
    ) {
      queuePendingLog(row);
      return;
    }

    try {
      await insertAccessLog(toDbInsertPayload(row, user));
    } catch (e) {
      console.error("Не удалось записать лог обращения:", e?.message || e, e);
      row.work_mode = getWorkMode() === "offline" ? "offline" : row.work_mode;
      queuePendingLog(row);
    }
  } finally {
    inFlightLogIds.delete(flightId);
  }
}

/** Лог SPA-раздела после переключения (время — до отрисовки кадра). */
export function logSpaSectionAccess(sectionId, responseTimeMs = null) {
  void logSiteAccess({
    pagePath: buildPagePathForSection(sectionId),
    pageTitle: `${document.title} — ${sectionId}`,
    responseTimeMs,
  });
}

/** Успешный вход (пароль или ссылка). */
export async function logSuccessfulLogin(user = state.currentUser) {
  await logSiteAccess({
    pagePath: "/login",
    pageTitle: "Успешный вход",
    user: user || null,
    force: true,
    responseTimeMs: null,
  });
}

/**
 * Звонок клиенту из меню заказа.
 * @param {{ orderId?: number|string|null, phone?: string|null }} opts
 */
export function logPhoneCall(opts = {}) {
  const orderId = opts.orderId != null && opts.orderId !== "" ? String(opts.orderId) : "";
  const phone = String(opts.phone || "").trim();
  const q = new URLSearchParams();
  if (orderId) q.set("order_id", orderId);
  if (phone) q.set("phone", phone.replace(/[^\d+]/g, ""));
  const qs = q.toString();
  void logSiteAccess({
    pagePath: qs ? `/call?${qs}` : "/call",
    pageTitle: phone ? `Звонок ${phone}` : "Звонок",
    force: true,
  });
}

/**
 * Открытие карточки заказа (просмотр / редактирование) — даже если раздел уже «new».
 * @param {{ orderId: number|string, mode?: 'view'|'edit' }} opts
 */
export function logOrderPageAccess(opts) {
  const orderId = opts?.orderId;
  if (orderId == null || orderId === "") return;
  const mode = opts.mode === "edit" ? "edit" : "view";
  const id = encodeURIComponent(String(orderId));
  void logSiteAccess({
    pagePath: `/new?order_id=${id}`,
    pageTitle: mode === "edit" ? `Редактирование заказа ${orderId}` : `Просмотр заказа ${orderId}`,
    force: true,
  });
}

export function initAccessLogging() {
  window.addEventListener("online", () => {
    void flushPendingAccessLogs();
  });
  window.addEventListener("db-ping-ok", () => {
    void flushPendingAccessLogs();
  });
  // Восстановление вкладки из bfcache — отдельное обращение.
  window.addEventListener("pageshow", (ev) => {
    if (!ev.persisted) return;
    if (!state.currentUser?.id) return;
    measureAfterPaint(() => {
      void logSiteAccess({
        pagePath: getCurrentPagePath(),
        pageTitle: `${document.title} — восстановление вкладки`,
        responseTimeMs: null,
        force: true,
      });
    });
  });
}
