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
let restoreGeneration = 0;
const entrySnapshots = new Map();

function key() {
  let id = history.state?.[ENTRY];
  if (id) return id;
  id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  history.replaceState({ ...(history.state || {}), [ENTRY]: id }, "", location.href);
  return id;
}

export function captureNavigationState(anchor = null) {
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
    anchor,
    extra: captureExtra?.() || null,
  };
  entrySnapshots.set(id, snapshot);
  try {
    const serialized = JSON.stringify(snapshot);
    sessionStorage.setItem(PREFIX + id, serialized);
    sessionStorage.setItem(URL_PREFIX + location.pathname + location.search + location.hash, serialized);
  } catch {}
  return snapshot;
}

export function readNavigationState() {
  const id = history.state?.[ENTRY];
  const inMemory = entrySnapshots.get(id);
  if (inMemory?.url === location.href) return inMemory;
  try {
    const data = JSON.parse((id && sessionStorage.getItem(PREFIX + id)) || sessionStorage.getItem(URL_PREFIX + location.pathname + location.search + location.hash) || "null");
    return data?.url === location.href ? data : null;
  } catch { return null; }
}

export function beginNavigationRestore() {
  restoring = true;
  navigationLeaving = false;
  clearTimeout(window.__navigationCaptureTimer);
  return ++restoreGeneration;
}
export function prepareNavigationDeparture() {
  if (restoring || navigationLeaving) return;
  captureNavigationState();
  navigationLeaving = true;
  clearTimeout(window.__navigationCaptureTimer);
}
export function endNavigationRestore(generation) {
  if (generation === restoreGeneration) restoring = false;
}

function restoreRowOffset(section, anchor) {
  if (!anchor?.calculationId) return;
  const row = section.querySelector(`#calculationsTable tr[data-calculation-id="${CSS.escape(anchor.calculationId)}"]`);
  if (!row) return;

  // Reposition the same transaction if a refresh added or removed rows above it.
  for (let el = row.parentElement; el && el !== document.scrollingElement; el = el.parentElement) {
    const delta = row.getBoundingClientRect().top - anchor.top;
    if (Math.abs(delta) < 1) return;
    if (el.scrollHeight > el.clientHeight && /^(auto|scroll|overlay)$/.test(getComputedStyle(el).overflowY)) {
      el.scrollTop += delta;
    }
  }
  const delta = row.getBoundingClientRect().top - anchor.top;
  if (Math.abs(delta) >= 1) window.scrollBy(0, delta);
}

export async function restoreNavigationScroll(snapshot, generation) {
  try {
    if (!snapshot) return;
    // Wait for the active section's layout and for native history traversal to finish.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (generation !== restoreGeneration) return;
    const section = document.getElementById(snapshot.sectionId);
    if (!section?.classList.contains("active")) return;

    window.scrollTo(snapshot.documentLeft || snapshot.x || 0, snapshot.documentTop || snapshot.y || 0);
    for (const [id, top, left] of snapshot.shellScrolls || []) {
      const el = document.getElementById(id);
      if (el) { el.scrollTop = top; el.scrollLeft = left; }
    }
    section.scrollTop = snapshot.sectionTop || 0;
    section.scrollLeft = snapshot.sectionLeft || 0;
    const nodes = section.querySelectorAll("*");
    for (const [index, top, left] of snapshot.scrolls || []) {
      const el = nodes[index];
      if (el) { el.scrollTop = top; el.scrollLeft = left; }
    }
    restoreRowOffset(section, snapshot.anchor);
  } finally {
    endNavigationRestore(generation);
  }
}

export function initNavigationHistory({ capture }) {
  captureExtra = capture;
  key();
  try { history.scrollRestoration = "manual"; } catch {}
  // Observe links after app handlers so an intercepted SPA link doesn't freeze capture.
  document.addEventListener("click", event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest("a[href]");
    if (link?.origin === location.origin && (!link.target || link.target === "_self") &&
        !link.hasAttribute("download") && (link.pathname !== location.pathname || link.search !== location.search)) {
      prepareNavigationDeparture();
    }
  });
  window.addEventListener("pagehide", () => captureNavigationState());
  window.addEventListener("pageshow", (event) => {
    updateNavigationBackButton();
    if (!event.persisted) return;
    navigationLeaving = false;
    const snapshot = readNavigationState();
    if (!snapshot || snapshot.sectionId !== document.querySelector(".content-section.active")?.id) return;
    void restoreNavigationScroll(snapshot, beginNavigationRestore());
  });
  window.addEventListener("scroll", () => {
    if (restoring || navigationLeaving) return;
    if (window.__navigationCaptureTimer) clearTimeout(window.__navigationCaptureTimer);
    window.__navigationCaptureTimer = setTimeout(captureNavigationState, 250);
  }, { passive: true, capture: true });
  document.getElementById("navigationBackBtn")?.addEventListener("click", () => {
    if (history.length <= 1 || restoring || navigationLeaving) return;
    prepareNavigationDeparture();
    history.back();
  });
  updateNavigationBackButton();
}

export function updateNavigationBackButton() {
  const button = document.getElementById("navigationBackBtn");
  if (button) button.disabled = history.length <= 1;
}
