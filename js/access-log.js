import { supabaseClient } from "./config.js";
import { state } from "./state.js";

const GEO_CACHE_KEY = "orders_site_access_geo_v1";
const PENDING_LOGS_KEY = "orders_site_pending_access_logs_v1";
const DEDUPE_MS = 2000;

let lastLogKey = "";
let lastLogAt = 0;
let geoCachePromise = null;
let sectionSwitchStartedAt = null;

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
      const hints = await navigator.userAgentData.getHighEntropyValues([
        "platform",
        "platformVersion",
        "model",
        "mobile",
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
      const timer = setTimeout(() => controller.abort(), 5000);
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

function shouldSkipDuplicate(pagePath) {
  const key = pagePath;
  const now = Date.now();
  if (key === lastLogKey && now - lastLogAt < DEDUPE_MS) return true;
  lastLogKey = key;
  lastLogAt = now;
  return false;
}

function queuePendingLog(row) {
  const list = readJsonStorage(PENDING_LOGS_KEY, []);
  list.push({ ...row, queuedAt: new Date().toISOString() });
  writeJsonStorage(PENDING_LOGS_KEY, list.slice(-50));
}

async function insertAccessLog(row) {
  const { error } = await supabaseClient.from("site_access_logs").insert(row);
  if (error) throw error;
}

export async function flushPendingAccessLogs(user = state.currentUser) {
  if (!user?.id) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;

  const list = readJsonStorage(PENDING_LOGS_KEY, []);
  if (!list.length) return;

  const remaining = [];
  for (const item of list) {
    try {
      await insertAccessLog({
        user_id: user.id,
        user_email: user.email || item.user_email || null,
        page_path: item.page_path,
        page_title: item.page_title ?? null,
        device_type: item.device_type ?? null,
        device_name: item.device_name ?? null,
        os_name: item.os_name ?? null,
        os_version: item.os_version ?? null,
        city: item.city ?? null,
        country: item.country ?? null,
        vpn_detected: item.vpn_detected ?? null,
        response_time_ms: item.response_time_ms ?? null,
      });
    } catch (e) {
      console.warn("Не удалось отправить отложенный лог обращения:", e);
      remaining.push(item);
    }
  }
  writeJsonStorage(PENDING_LOGS_KEY, remaining);
}

/**
 * Записать обращение к странице/разделу в site_access_logs.
 * @param {{ pagePath?: string, pageTitle?: string, responseTimeMs?: number|null, user?: object|null, force?: boolean }} opts
 */
export async function logSiteAccess(opts = {}) {
  const pagePath = opts.pagePath || getCurrentPagePath();
  if (!opts.force && shouldSkipDuplicate(pagePath)) return;

  const user = opts.user ?? state.currentUser ?? null;
  const [device, geo] = await Promise.all([collectDeviceInfo(), fetchGeoInfo()]);

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
  };

  if (!user?.id) {
    queuePendingLog(row);
    return;
  }

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    queuePendingLog(row);
    return;
  }

  try {
    await insertAccessLog({ ...row, user_id: user.id });
  } catch (e) {
    console.warn("Не удалось записать лог обращения:", e);
    queuePendingLog(row);
  }
}

/** Лог SPA-раздела после переключения (время — до отрисовки кадра). */
export function logSpaSectionAccess(sectionId, responseTimeMs = null) {
  const pagePath = `${window.location.pathname}${window.location.search}#${sectionId}`;
  void logSiteAccess({
    pagePath,
    pageTitle: `${document.title} — ${sectionId}`,
    responseTimeMs,
  });
}

export function initAccessLogging() {
  window.addEventListener("online", () => {
    void flushPendingAccessLogs();
  });
}
