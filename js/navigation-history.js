/**
 * Per-history-entry view snapshots. Stored in sessionStorage so a full navigation
 * to an order and the browser Back button retain filters and table scroll.
 */
const PREFIX = "orders_site_navigation_v1:";
const ENTRY = "__ordersNavigationEntry";
const URL_PREFIX = "orders_site_navigation_url_v1:";
let restoring = false;
let navigationLeaving = false;
let captureExtra = null;

function key() {
  let id = history.state?.[ENTRY];
  if (id) return id;
  id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  history.replaceState({ ...(history.state || {}), [ENTRY]: id }, "", location.href);
  return id;
}

export function captureNavigationState() {
  if (restoring || navigationLeaving) return null;
  const id = key();
  const section = document.querySelector(".content-section.active");
  const scrolls = [];
  const shellScrolls = ["appContainer", "section-calculations", "section-all", "ordersTableScrollBottom", "ordersTableScrollInner"]
    .map(id => { const el = document.getElementById(id); return el ? [id, el.scrollTop, el.scrollLeft] : null; })
    .filter(Boolean);
  if (section) {
    section.querySelectorAll("*").forEach((el, index) => {
      if (el.scrollTop || el.scrollLeft) scrolls.push([index, el.scrollTop, el.scrollLeft]);
    });
  }
  const snapshot = {
    url: location.href, x: window.scrollX, y: window.scrollY,
    documentTop: document.scrollingElement?.scrollTop || 0,
    documentLeft: document.scrollingElement?.scrollLeft || 0,
    sectionTop: section?.scrollTop || 0, sectionLeft: section?.scrollLeft || 0,
    scrolls, shellScrolls, sectionId: section?.id || "",
    extra: captureExtra?.() || null,
  };
  try {
    sessionStorage.setItem(PREFIX + id, JSON.stringify(snapshot));
    sessionStorage.setItem(URL_PREFIX + location.pathname + location.search + location.hash, JSON.stringify(snapshot));
  } catch {}
  return snapshot;
}

export function readNavigationState() {
  const id = history.state?.[ENTRY];
  try {
    const data = JSON.parse((id && sessionStorage.getItem(PREFIX + id)) || sessionStorage.getItem(URL_PREFIX + location.pathname + location.search + location.hash) || "null");
    return data?.url === location.href ? data : null;
  } catch { return null; }
}

export function beginNavigationRestore() { restoring = true; navigationLeaving = false; }
export function prepareNavigationDeparture() {
  if (restoring || navigationLeaving) return;
  captureNavigationState();
  navigationLeaving = true;
  clearTimeout(window.__navigationCaptureTimer);
}
export function endNavigationRestore() { restoring = false; }

export async function restoreNavigationScroll(snapshot) {
  if (!snapshot) { restoring = false; return; }
  restoring = true;
  const apply = () => {
    const top = snapshot.documentTop ?? snapshot.y ?? 0;
    const left = snapshot.documentLeft ?? snapshot.x ?? 0;
    window.scrollTo(left, top);
    if (document.scrollingElement) {
      document.scrollingElement.scrollTop = top;
      document.scrollingElement.scrollLeft = left;
    }
    for (const [id, top, left] of snapshot.shellScrolls || []) {
      const el = document.getElementById(id);
      if (el) { el.scrollTop = top; el.scrollLeft = left; }
    }
    const section = document.getElementById(snapshot.sectionId);
    if (!section) return;
    section.scrollTop = snapshot.sectionTop || 0;
    section.scrollLeft = snapshot.sectionLeft || 0;
    const nodes = section.querySelectorAll("*");
    for (const [index, top, left] of snapshot.scrolls || []) {
      const el = nodes[index];
      if (el) { el.scrollTop = top; el.scrollLeft = left; }
    }
  };
  apply();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  apply();
  await new Promise(resolve => setTimeout(resolve, 200));
  apply();
  await new Promise(resolve => setTimeout(resolve, 400));
  apply();
  // iOS PWA can finish laying out the calculations table after the route resolves.
  await new Promise(resolve => setTimeout(resolve, 900));
  apply();
  restoring = false;
}

export function initNavigationHistory({ capture }) {
  captureExtra = capture;
  key();
  try { history.scrollRestoration = "manual"; } catch {}
  // Freeze the outgoing snapshot on link activation. iOS may scroll to top
  // during pagehide, which must never replace the departure position.
  document.addEventListener("click", event => {
    const link = event.target.closest("a[href]");
    if (link && link.origin === location.origin && !event.defaultPrevented) prepareNavigationDeparture();
  }, true);
  window.addEventListener("pagehide", () => { if (!restoring && !navigationLeaving) captureNavigationState(); });
  window.addEventListener("pageshow", () => { if (!restoring) updateNavigationBackButton(); });
  window.addEventListener("scroll", () => {
    if (restoring) return;
    if (window.__navigationCaptureTimer) clearTimeout(window.__navigationCaptureTimer);
    window.__navigationCaptureTimer = setTimeout(captureNavigationState, 250);
  }, { passive: true, capture: true });
  document.getElementById("navigationBackBtn")?.addEventListener("click", () => {
    if (history.length > 1) history.back();
  });
  updateNavigationBackButton();
}

export function updateNavigationBackButton() {
  const button = document.getElementById("navigationBackBtn");
  if (button) button.disabled = history.length <= 1;
}
