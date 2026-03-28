/**
 * iPhone: щипок двумя пальцами по области таблицы заказов — масштаб только таблицы (CSS zoom),
 * без масштаба всей страницы и без конфликта с жестами Safari (preventDefault на touchmove при 2 касаниях).
 */

const STORAGE_KEY = "ordersTablePinchZoom";
const MIN_SCALE = 0.2;
const MAX_SCALE = 1.5;

const TOUCH_UI = "(hover: none) and (pointer: coarse)";

function isTouchUi() {
  return typeof window.matchMedia === "function" && window.matchMedia(TOUCH_UI).matches;
}

function isOrdersSectionActive() {
  return document.getElementById("section-all")?.classList.contains("active") ?? false;
}

function touchDistance(touches) {
  if (touches.length < 2) return 0;
  const a = touches[0];
  const b = touches[1];
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

let pinchScale = 1;
let pinchGesture = null;

function loadStoredScale() {
  try {
    const s = parseFloat(sessionStorage.getItem(STORAGE_KEY), 10);
    if (Number.isFinite(s) && s >= MIN_SCALE && s <= MAX_SCALE) {
      pinchScale = s;
    }
  } catch {
    /* ignore */
  }
}

function applyZoomToInner(inner) {
  if (!inner) return;
  if (!isOrdersSectionActive()) {
    inner.style.removeProperty("zoom");
    inner.classList.remove("orders-table-inner--pinch-zoom");
    return;
  }
  if (pinchScale === 1) {
    inner.style.removeProperty("zoom");
    inner.classList.remove("orders-table-inner--pinch-zoom");
  } else {
    inner.style.zoom = String(pinchScale);
    inner.classList.add("orders-table-inner--pinch-zoom");
  }
}

/** После перерисовки таблицы — снова применить сохранённый масштаб */
export function reapplyOrdersTablePinchZoom() {
  const inner = document.getElementById("ordersTableScrollInner");
  applyZoomToInner(inner);
}

export function resetOrdersTablePinchZoom() {
  pinchScale = 1;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  reapplyOrdersTablePinchZoom();
}

let inited = false;

export function initOrdersTablePinchZoom() {
  if (inited) return;
  inited = true;

  if (!isTouchUi()) return;

  loadStoredScale();

  const inner = document.getElementById("ordersTableScrollInner");
  if (!inner) return;

  applyZoomToInner(inner);

  inner.addEventListener(
    "touchstart",
    (e) => {
      if (!isOrdersSectionActive()) return;
      if (e.touches.length === 2) {
        const d = touchDistance(e.touches);
        if (d > 8) {
          pinchGesture = { startDist: Math.max(d, 1), startScale: pinchScale };
        }
      }
    },
    { passive: true }
  );

  inner.addEventListener(
    "touchmove",
    (e) => {
      if (!isOrdersSectionActive() || !pinchGesture || e.touches.length !== 2) return;
      e.preventDefault();
      const d = touchDistance(e.touches);
      if (d < 4) return;
      const next = pinchGesture.startScale * (d / pinchGesture.startDist);
      pinchScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
      inner.style.zoom = String(pinchScale);
      inner.classList.add("orders-table-inner--pinch-zoom");
    },
    { passive: false }
  );

  function onPinchEnd(e) {
    if (e.touches.length < 2) {
      pinchGesture = null;
      try {
        sessionStorage.setItem(STORAGE_KEY, String(pinchScale));
      } catch {
        /* ignore */
      }
    }
  }

  inner.addEventListener("touchend", onPinchEnd, { passive: true });
  inner.addEventListener("touchcancel", onPinchEnd, { passive: true });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") applyZoomToInner(inner);
  });

  if (typeof window.matchMedia === "function") {
    window.matchMedia(TOUCH_UI).addEventListener("change", () => {
      if (!isTouchUi()) {
        inner.style.removeProperty("zoom");
        inner.classList.remove("orders-table-inner--pinch-zoom");
      } else {
        loadStoredScale();
        applyZoomToInner(inner);
      }
    });
  }
}
