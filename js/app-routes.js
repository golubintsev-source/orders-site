/**
 * Служебный путь снимка строки «Сейчас» при открытии «Баланс».
 * Пишется в site_access_logs (как обычные обращения); не является UI-разделом.
 */
export const BALANCE_SNAPSHOT_PATH = "/balance-snapshot";

/** Разделы приложения, которые отражаются в адресной строке (кроме одноразового export Excel). */
export const ROUTE_SECTION_IDS = new Set([
  "all",
  "new",
  "calculations",
  "excess",
  "tasks-all",
  "changes-all",
  "balance",
  "manager-salary",
  "route-sheet",
  "settings",
  "statistics",
  "statistics-balance",
  "order-tasks",
  "messages",
  "voice",
]);

function normalizePathname(pathname) {
  let p = pathname.replace(/\/index\.html$/i, "") || "/";
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

const PATH_TO_SECTION = new Map([
  ["/", "all"],
  ["/all", "all"],
  ["/new", "new"],
  ["/calculations", "calculations"],
  ["/excess", "excess"],
  ["/tasks-all", "tasks-all"],
  ["/changes-all", "changes-all"],
  ["/balance", "balance"],
  ["/manager-salary", "manager-salary"],
  ["/route-sheet", "route-sheet"],
  ["/settings", "settings"],
  ["/statistics", "statistics"],
  ["/statistics-balance", "statistics-balance"],
  ["/order-tasks", "order-tasks"],
  ["/messages", "messages"],
  ["/voice", "voice"],
]);

export function usesHashOnlyRouting() {
  return window.location.protocol === "file:";
}

export function pathForRouteSection(sectionId) {
  if (sectionId === "all") return "/";
  return `/${sectionId}`;
}

/** Канонический путь для журнала обращений (без лишнего #раздел при path-routing). */
export function buildPagePathForSection(sectionId) {
  const { pathname, search, hash } = window.location;
  const base = `${pathname || "/"}${search || ""}`;

  if (usesHashOnlyRouting()) {
    if (sectionId === "all") return `${base}${hash || ""}`;
    return `${base}#${sectionId}`;
  }

  const normalized = normalizePathname(pathname);
  const pathSection = PATH_TO_SECTION.get(normalized);
  if (pathSection === sectionId) return base;
  if (sectionId === "all" && (normalized === "/" || normalized === "/all")) return base;
  return `${base}#${sectionId}`;
}

/** Для дедупликации: /statistics#statistics → /statistics */
export function normalizeAccessLogPath(pagePath) {
  const s = String(pagePath || "");
  const hashIdx = s.indexOf("#");
  if (hashIdx < 0) return s;
  const base = s.slice(0, hashIdx);
  const sectionId = s.slice(hashIdx + 1);
  if (!ROUTE_SECTION_IDS.has(sectionId)) return s;
  if (usesHashOnlyRouting()) return s;

  let pathOnly = base;
  try {
    pathOnly = new URL(base, window.location.origin).pathname;
  } catch {
    /* keep base */
  }
  const pathSection = PATH_TO_SECTION.get(normalizePathname(pathOnly));
  if (pathSection === sectionId) return base || "/";
  if (sectionId === "all" && (!base || base === "/")) return "/";
  return s;
}

/** Ссылка на главную (список заказов). */
export function hrefToHome() {
  return usesHashOnlyRouting() ? "index.html" : "/";
}

/** Ссылка на раздел SPA (для полной перезагрузки со страниц вне index). */
export function hrefToAppSection(sectionId) {
  if (sectionId === "orders-excel") return hrefToOrdersExcelExport();
  if (!ROUTE_SECTION_IDS.has(sectionId)) return hrefToHome();
  if (usesHashOnlyRouting()) {
    if (sectionId === "all") return "index.html";
    return `index.html#${sectionId}`;
  }
  return pathForRouteSection(sectionId);
}

export function hrefToOrdersExcelExport() {
  return usesHashOnlyRouting() ? "index.html#orders-excel" : "/?export=orders-excel";
}

/** Абсолютный URL просмотра заказа (для QR и шаринга). */
export function buildOrderViewUrl(orderId) {
  const id = encodeURIComponent(String(orderId));
  if (usesHashOnlyRouting()) {
    const u = new URL(window.location.href);
    u.searchParams.set("order_id", String(orderId));
    u.hash = "new";
    return u.href;
  }
  return `${window.location.origin}/new?order_id=${id}`;
}

/** ID заказа из ?order_id= или null. */
export function getOrderIdFromUrl() {
  const raw = new URLSearchParams(window.location.search).get("order_id");
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Синхронизировать ?order_id= в адресной строке (replaceState).
 * @param {number | string | null | undefined} orderId — null/undefined убирает параметр
 */
export function syncOrderIdInUrl(orderId) {
  const u = new URL(window.location.href);
  if (orderId == null || orderId === "") {
    if (!u.searchParams.has("order_id")) return;
    u.searchParams.delete("order_id");
  } else {
    const next = String(orderId);
    if (u.searchParams.get("order_id") === next) return;
    u.searchParams.set("order_id", next);
  }
  const path = u.pathname + u.search + u.hash;
  history.replaceState(null, "", path || "/");
}

function stripHashAndExportParam() {
  const u = new URL(window.location.href);
  u.hash = "";
  u.searchParams.delete("export");
  const path = u.pathname + u.search;
  return path === "" ? "/" : path;
}

/**
 * Одноразовый экспорт Excel: ?export=orders-excel или #orders-excel.
 * @returns {boolean} true, если сработал экспорт (URL очищен).
 */
export function tryConsumeOrdersExcelExport(canAccessOrdersExcel) {
  const hash = window.location.hash.replace(/^#/, "");
  const q = new URLSearchParams(window.location.search).get("export");
  const isExcel = hash === "orders-excel" || q === "orders-excel";
  if (!isExcel) return false;
  const clean = stripHashAndExportParam();
  if (!canAccessOrdersExcel) {
    history.replaceState(null, "", clean);
    return false;
  }
  history.replaceState(null, "", clean);
  void import("./ordersExcelExport.js").then((m) => m.exportOrdersToExcel());
  return true;
}

export function getRouteSectionFromUrl() {
  if (usesHashOnlyRouting()) {
    const h = window.location.hash.replace(/^#/, "");
    if (h === "orders-excel") return "all";
    if (ROUTE_SECTION_IDS.has(h)) return h;
    return "all";
  }
  const pathKey = normalizePathname(window.location.pathname);
  const fromPath = PATH_TO_SECTION.get(pathKey);
  const h = window.location.hash.replace(/^#/, "");
  const rootLike = pathKey === "/" || pathKey === "/all";

  if (!rootLike && fromPath) return fromPath;
  if (h && h !== "orders-excel" && ROUTE_SECTION_IDS.has(h)) return h;
  if (fromPath) return fromPath;
  return "all";
}

/** После загрузки: убрать устаревший #раздел при работе по путям (http/https). */
export function migrateLegacyHashToPathIfNeeded() {
  if (usesHashOnlyRouting()) return;
  const h = window.location.hash.replace(/^#/, "");
  if (!h || h === "orders-excel" || !ROUTE_SECTION_IDS.has(h)) return;
  history.replaceState(null, "", pathForRouteSection(h) + window.location.search);
}

export function syncBrowserUrlToSection(sectionId) {
  if (!ROUTE_SECTION_IDS.has(sectionId)) return;

  const search = new URLSearchParams(window.location.search);
  if (sectionId !== "new") {
    search.delete("order_id");
  }
  const searchStr = search.toString();
  const q = searchStr ? `?${searchStr}` : "";

  if (usesHashOnlyRouting()) {
    const base = window.location.pathname + q;
    const targetHash = sectionId === "all" ? "" : `#${sectionId}`;
    const next = `${base}${targetHash}`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` === next) return;
    history.pushState(null, "", next);
    return;
  }

  const want = pathForRouteSection(sectionId);
  const cur = normalizePathname(window.location.pathname);
  const curSection = PATH_TO_SECTION.get(cur);
  const curSearch = window.location.search || "";
  if (curSection === sectionId && !window.location.hash && curSearch === q) return;

  history.pushState(null, "", want + q);
}
