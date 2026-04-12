/**
 * Фиксированная копия thead таблицы заказов (Safari/iOS часто ломают CSS sticky).
 * Горизонталь: сдвиг клона через translate3d от scrollLeft основной области — без второго scroll
 * (два sync scrollLeft на iOS дают рывки и ломают инерцию).
 */

const WRAP_ID = "ordersTableStickyHeadWrap";
const PAN_ID = "ordersTableStickyHeadPan";
const THEAD_ID = "ordersTableStickyThead";

let inited = false;
let rafPending = false;

function getTopbarStickyOffset() {
  const topbar = document.querySelector(".container .topbar");
  if (!topbar) return 0;
  const r = topbar.getBoundingClientRect();
  if (r.bottom <= 0) return 0;
  return Math.max(0, Math.ceil(r.bottom));
}

/**
 * Верхняя граница закреплённой шапки: не ниже шапки сайта и ниже полосы
 * #ordersTableScrollTop (на ПК), иначе клон перекрывает горизонтальный скролл.
 */
function getStickyHeaderAnchorTop() {
  const fromTopbar = getTopbarStickyOffset();
  const scrollTopEl = document.getElementById("ordersTableScrollTop");
  if (scrollTopEl) {
    const cs = getComputedStyle(scrollTopEl);
    if (cs.display !== "none" && cs.visibility !== "hidden") {
      const r = scrollTopEl.getBoundingClientRect();
      if (r.height > 0) {
        return Math.max(fromTopbar, Math.ceil(r.bottom));
      }
    }
  }
  const inner = document.getElementById("ordersTableScrollInner");
  if (inner) {
    const ir = inner.getBoundingClientRect();
    return Math.max(fromTopbar, Math.ceil(ir.top));
  }
  return fromTopbar;
}

function positionStickyWrap(wrap) {
  const inner = document.getElementById("ordersTableScrollInner");
  if (!wrap || !inner) return;
  const r = inner.getBoundingClientRect();
  wrap.style.left = `${Math.max(0, r.left)}px`;
  wrap.style.width = `${Math.max(0, r.width)}px`;
}

function isStickyHeaderVisible() {
  const wrap = document.getElementById(WRAP_ID);
  return Boolean(wrap && !wrap.hidden);
}

function applyStickyHeaderPan() {
  if (!isStickyHeaderVisible()) return;
  const pan = document.getElementById(PAN_ID);
  const inner = document.getElementById("ordersTableScrollInner");
  if (!pan || !inner) return;
  pan.style.transform = `translate3d(${-inner.scrollLeft}px, 0, 0)`;
}

function clearStickyHeaderPan() {
  const pan = document.getElementById(PAN_ID);
  if (pan) pan.style.transform = "";
}

function hideStickyWrap(wrap) {
  if (!wrap) return;
  wrap.hidden = true;
  wrap.setAttribute("aria-hidden", "true");
  wrap.style.height = "";
  clearStickyHeaderPan();
}

/** Высота клона = у оригинального thead, иначе блок с фоном #f8fafc перекрывает первую строку tbody. */
function syncStickyHeaderHeight(wrap, thead) {
  if (!wrap || wrap.hidden || !thead) return;
  const h = thead.offsetHeight;
  if (h > 0) wrap.style.height = `${h}px`;
}

function syncStickyColumnWidths() {
  const wrap = document.getElementById(WRAP_ID);
  if (!wrap || wrap.hidden) return;
  const origThs = document.querySelectorAll("#ordersTable thead th");
  const cloneThs = document.querySelectorAll(`#${THEAD_ID} th`);
  if (!origThs.length || origThs.length !== cloneThs.length) return;
  origThs.forEach((th, i) => {
    const w = th.getBoundingClientRect().width;
    const c = cloneThs[i];
    if (c && w > 0) {
      c.style.width = `${w}px`;
      c.style.minWidth = `${w}px`;
      c.style.maxWidth = `${w}px`;
      c.style.boxSizing = "border-box";
    }
  });
}

export function refreshOrdersTableStickyClone() {
  const origThead = document.querySelector("#ordersTable thead");
  const dest = document.getElementById(THEAD_ID);
  if (!origThead || !dest) return;
  dest.innerHTML = origThead.innerHTML;
  dest.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
}

function updateStickyHeaderState() {
  const wrap = document.getElementById(WRAP_ID);
  const section = document.getElementById("section-all");
  const table = document.getElementById("ordersTable");
  if (!wrap || !table) return;

  if (!section?.classList.contains("active")) {
    hideStickyWrap(wrap);
    return;
  }

  const thead = table.querySelector("thead");
  if (!thead) return;

  const tableRect = table.getBoundingClientRect();
  const theadRect = thead.getBoundingClientRect();
  const vv = window.visualViewport;
  const vh = vv ? vv.height : window.innerHeight;

  if (tableRect.bottom <= 0 || tableRect.top >= vh) {
    hideStickyWrap(wrap);
    return;
  }

  const anchorTop = getStickyHeaderAnchorTop();
  const shouldShow = theadRect.top < anchorTop;

  if (!shouldShow) {
    hideStickyWrap(wrap);
    return;
  }

  wrap.hidden = false;
  wrap.style.top = `${anchorTop}px`;
  wrap.setAttribute("aria-hidden", "false");
  positionStickyWrap(wrap);
  syncStickyColumnWidths();
  syncStickyHeaderHeight(wrap, thead);
  applyStickyHeaderPan();
}

export function scheduleOrdersStickyHeaderUpdate() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    updateStickyHeaderState();
  });
}

export function initOrdersTableStickyHeader() {
  if (inited) return;
  inited = true;

  const wrap = document.getElementById(WRAP_ID);
  const pan = document.getElementById(PAN_ID);
  if (!wrap || !pan) return;

  refreshOrdersTableStickyClone();

  wrap.addEventListener(
    "click",
    (e) => {
      const typeBtn = e.target.closest(".order-type-filter-btn");
      if (typeBtn && wrap.contains(typeBtn)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        document.getElementById("orderTypeFilterBtn")?.click();
        return;
      }
      const paidBtn = e.target.closest(".paid-filter-btn");
      if (paidBtn && wrap.contains(paidBtn)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        document.getElementById("paidFilterBtn")?.click();
        return;
      }
      const statusBtn = e.target.closest(".orders-status-column-filter-btn");
      if (statusBtn && wrap.contains(statusBtn)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        document.getElementById("statusFilterBtn")?.click();
        return;
      }
      const dateTh = e.target.closest("th.th-order-date-header");
      if (dateTh && wrap.contains(dateTh)) {
        const dateBtn = dateTh.querySelector(".orders-filter-heading-btn");
        if (dateBtn && (e.target === dateBtn || dateBtn.contains(e.target))) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          document.getElementById("orderDateFilterBtn")?.click();
        }
      }
    },
    true
  );

  window.addEventListener(
    "scroll",
    () => {
      scheduleOrdersStickyHeaderUpdate();
    },
    { passive: true, capture: true }
  );

  window.addEventListener(
    "resize",
    () => {
      scheduleOrdersStickyHeaderUpdate();
    },
    { passive: true }
  );

  const outer = document.getElementById("ordersTableScrollBottom");
  const inner = document.getElementById("ordersTableScrollInner");
  if (outer) {
    outer.addEventListener(
      "scroll",
      () => {
        scheduleOrdersStickyHeaderUpdate();
      },
      { passive: true }
    );
  }
  if (inner) {
    inner.addEventListener(
      "scroll",
      () => {
        applyStickyHeaderPan();
      },
      { passive: true }
    );
  }

  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener("scroll", scheduleOrdersStickyHeaderUpdate, { passive: true });
    vv.addEventListener("resize", scheduleOrdersStickyHeaderUpdate, { passive: true });
  }

  scheduleOrdersStickyHeaderUpdate();
}

/** После перерисовки строк — пересчитать ширины и видимость клона. */
export function refreshOrdersTableStickyHeader() {
  scheduleOrdersStickyHeaderUpdate();
}
