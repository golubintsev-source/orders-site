/**
 * Per-history-entry view snapshots. Stored in sessionStorage so a full navigation
 * to an order and the browser Back button retain filters and table scroll.
 */
const PREFIX = "orders_site_navigation_v1:";
const ENTRY = "__ordersNavigationEntry";
let captureExtra = null;

function key() {
  let id = history.state?.[ENTRY];
  if (id) return id;
  id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  history.replaceState({ ...(history.state || {}), [ENTRY]: id }, "", location.href);
  return id;
}

export function captureNavigationState() {
  const id = key();
  const section = document.querySelector(".content-section.active");
  const scrolls = [];
  if (section) {
    section.querySelectorAll("*").forEach((el, index) => {
      if (el.scrollTop || el.scrollLeft) scrolls.push([index, el.scrollTop, el.scrollLeft]);
    });
  }
  const snapshot = {
    url: location.href, x: window.scrollX, y: window.scrollY,
    scrolls, sectionId: section?.id || "",
    extra: captureExtra?.() || null,
  };
  try { sessionStorage.setItem(PREFIX + id, JSON.stringify(snapshot)); } catch {}
  return snapshot;
}

export function readNavigationState() {
  const id = history.state?.[ENTRY];
  if (!id) return null;
  try {
    const data = JSON.parse(sessionStorage.getItem(PREFIX + id) || "null");
    return data?.url === location.href ? data : null;
  } catch { return null; }
}

export async function restoreNavigationScroll(snapshot) {
  if (!snapshot) return;
  const apply = () => {
    window.scrollTo(snapshot.x || 0, snapshot.y || 0);
    const section = document.getElementById(snapshot.sectionId);
    if (!section) return;
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
}

export function initNavigationHistory({ capture }) {
  captureExtra = capture;
  key();
  try { history.scrollRestoration = "manual"; } catch {}
  // Capture before normal links (including the order link in calculations) navigate.
  document.addEventListener("click", event => {
    if (event.target.closest("a[href]")) captureNavigationState();
  }, true);
  window.addEventListener("pagehide", captureNavigationState);
  window.addEventListener("scroll", () => {
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
