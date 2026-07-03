import { usesHashOnlyRouting } from "./app-routes.js";

const STORAGE_PREFIX = "orders_site_user_place_v1:";

const SCROLL_CONTAINER_IDS = ["ordersTableScrollBottom", "ordersTableScrollInner"];

/** @typedef {{ scrollTop?: number, scrollLeft?: number }} ContainerScroll */
/** @typedef {{
 *   at: string,
 *   href: string,
 *   scrollY?: number,
 *   scrollX?: number,
 *   scrollContainers?: Record<string, ContainerScroll>,
 *   app?: {
 *     sectionId?: string,
 *     viewingOrderId?: number | null,
 *     editingOrderId?: number | null,
 *     tasksOrderId?: number | null,
 *     clientSearch?: string,
 *   },
 * }} UserPlaceState */

let activeUserId = null;
/** @type {(() => import("./state.js").state extends infer S ? () => Partial<UserPlaceState["app"]> : never) | null} */
let getAppContext = null;
let saveTimer = null;
let trackingBound = false;

function storageKey(userId) {
  return `${STORAGE_PREFIX}${userId}`;
}

/** Относительный адрес страницы (без origin). */
export function captureHref() {
  if (usesHashOnlyRouting()) {
    const file = window.location.pathname.split(/[/\\]/).pop() || "index.html";
    return `${file}${window.location.search || ""}${window.location.hash || ""}`;
  }
  let path = window.location.pathname || "/";
  if (path.endsWith("/index.html")) path = path.slice(0, -"/index.html".length) || "/";
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return `${path}${window.location.search || ""}${window.location.hash || ""}`;
}

function normalizeHrefForCompare(href) {
  let s = String(href || "").trim();
  if (!s) return usesHashOnlyRouting() ? "index.html" : "/";
  if (usesHashOnlyRouting()) {
    if (s.startsWith("/")) s = s.slice(1);
    const q = s.indexOf("?");
    const h = s.indexOf("#");
    const end = q >= 0 && h >= 0 ? Math.min(q, h) : q >= 0 ? q : h >= 0 ? h : s.length;
    const file = s.slice(0, end).split(/[/\\]/).pop() || "index.html";
    return file + s.slice(end);
  }
  if (!s.startsWith("/")) s = `/${s}`;
  if (s === "/index.html") return "/";
  return s;
}

function isLoginHref(href) {
  const n = normalizeHrefForCompare(href);
  return n === "login.html" || n === "/login.html";
}

function readContainerScroll(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  return { scrollTop: el.scrollTop, scrollLeft: el.scrollLeft };
}

function applyContainerScroll(id, scroll) {
  if (!scroll) return;
  const el = document.getElementById(id);
  if (!el) return;
  if (scroll.scrollTop != null) el.scrollTop = scroll.scrollTop;
  if (scroll.scrollLeft != null) el.scrollLeft = scroll.scrollLeft;
}

function shouldCaptureOrdersTableScroll() {
  return Boolean(document.getElementById("section-all")?.classList.contains("active"));
}

/** @returns {UserPlaceState} */
export function captureUserPlace() {
  /** @type {Record<string, ContainerScroll>} */
  const scrollContainers = {};
  if (shouldCaptureOrdersTableScroll()) {
    for (const id of SCROLL_CONTAINER_IDS) {
      const s = readContainerScroll(id);
      if (s) scrollContainers[id] = s;
    }
  }

  /** @type {UserPlaceState} */
  const place = {
    at: new Date().toISOString(),
    href: captureHref(),
    scrollY: window.scrollY,
    scrollX: window.scrollX,
    scrollContainers,
  };

  if (typeof getAppContext === "function") {
    const app = getAppContext();
    if (app && Object.keys(app).length) place.app = app;
  }

  return place;
}

/** @returns {UserPlaceState | null} */
export function readUserPlace(userId) {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o.href !== "string") return null;
    return o;
  } catch {
    return null;
  }
}

export function saveUserPlace(userId, place) {
  if (!userId) return;
  const href = place?.href ?? captureHref();
  if (isLoginHref(href)) return;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(place ?? captureUserPlace()));
  } catch {
    /* ignore quota */
  }
}

export function scheduleSaveUserPlace() {
  if (!activeUserId) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveUserPlace(activeUserId, captureUserPlace());
  }, 350);
}

function flushSaveUserPlace() {
  if (!activeUserId) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saveUserPlace(activeUserId, captureUserPlace());
}

export function hrefMatchesCurrent(savedHref) {
  return normalizeHrefForCompare(savedHref) === normalizeHrefForCompare(captureHref());
}

export function isDefaultAppEntryHref(href) {
  const n = normalizeHrefForCompare(href);
  if (usesHashOnlyRouting()) return n === "index.html";
  return n === "/" || n === "/all";
}

export function shouldRedirectToSavedPlace(currentHref, savedHref) {
  if (!savedHref || isLoginHref(savedHref)) return false;
  if (normalizeHrefForCompare(currentHref) === normalizeHrefForCompare(savedHref)) return false;
  return isDefaultAppEntryHref(currentHref);
}

/** Ссылка для перехода после входа или с «домашней» страницы. */
export function getResumeHref(userId, fallbackHref) {
  const saved = readUserPlace(userId);
  if (!saved?.href || isLoginHref(saved.href)) return fallbackHref;
  return resolvePlaceHref(saved.href);
}

export function resolvePlaceHref(href) {
  const h = String(href || "").trim();
  if (!h) return href;
  if (usesHashOnlyRouting()) return h;
  if (h.startsWith("/") || h.startsWith("http")) return h;
  return `/${h}`;
}

function bindTrackingEvents() {
  if (trackingBound) return;
  trackingBound = true;

  window.addEventListener("scroll", scheduleSaveUserPlace, { passive: true, capture: true });
  for (const id of SCROLL_CONTAINER_IDS) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("scroll", scheduleSaveUserPlace, { passive: true });
  }

  window.addEventListener("pagehide", flushSaveUserPlace);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSaveUserPlace();
  });
}

/**
 * Периодически сохранять место пользователя на странице.
 * @param {string} userId
 * @param {{ getAppContext?: () => UserPlaceState["app"] }} [opts]
 */
export function initUserPlaceTracking(userId, opts = {}) {
  activeUserId = userId;
  getAppContext = typeof opts.getAppContext === "function" ? opts.getAppContext : null;
  bindTrackingEvents();
}

/** Восстановить прокрутку после загрузки контента. */
export async function applySavedScroll(place) {
  if (!place) return;

  const apply = () => {
    if (place.scrollY != null || place.scrollX != null) {
      window.scrollTo(place.scrollX ?? 0, place.scrollY ?? 0);
    }
    if (shouldCaptureOrdersTableScroll() && place.scrollContainers) {
      for (const id of SCROLL_CONTAINER_IDS) {
        applyContainerScroll(id, place.scrollContainers[id]);
      }
    }
  };

  apply();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  apply();
  await new Promise((r) => setTimeout(r, 120));
  apply();
  if (place.scrollContainers && Object.keys(place.scrollContainers).length) {
    await new Promise((r) => setTimeout(r, 350));
    apply();
  }
}

/** @returns {UserPlaceState | null} */
export function readSavedPlaceForCurrentPage(userId) {
  const saved = readUserPlace(userId);
  if (!saved || !hrefMatchesCurrent(saved.href)) return null;
  return saved;
}
