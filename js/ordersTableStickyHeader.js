/**
 * Фиксированная копия thead таблицы заказов (Safari/iOS часто ломают CSS sticky).
 * Показ когда строка заголовка ушла под верх экрана; sync scrollLeft и ширин колонок.
 */

const WRAP_ID = "ordersTableStickyHeadWrap";
const SCROLL_ID = "ordersTableStickyHeadScroll";
const THEAD_ID = "ordersTableStickyThead";

let inited = false;
let rafPending = false;
let ignoreInnerToSticky = false;
let ignoreStickyToInner = false;

function getTopbarStickyOffset() {
  const topbar = document.querySelector(".container .topbar");
  if (!topbar) return 0;
  const r = topbar.getBoundingClientRect();
  if (r.bottom <= 0) return 0;
  return Math.max(0, Math.ceil(r.bottom));
}

function positionStickyWrap(wrap) {
  const inner = document.getElementById("ordersTableScrollInner");
  if (!wrap || !inner) return;
  const r = inner.getBoundingClientRect();
  wrap.style.left = `${Math.max(0, r.left)}px`;
  wrap.style.width = `${Math.max(0, r.width)}px`;
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

function syncScrollLeftFromInner() {
  const scrollEl = document.getElementById(SCROLL_ID);
  const inner = document.getElementById("ordersTableScrollInner");
  if (!scrollEl || !inner || ignoreInnerToSticky) return;
  ignoreStickyToInner = true;
  scrollEl.scrollLeft = inner.scrollLeft;
  requestAnimationFrame(() => {
    ignoreStickyToInner = false;
  });
}

function syncScrollLeftToInner() {
  const scrollEl = document.getElementById(SCROLL_ID);
  const inner = document.getElementById("ordersTableScrollInner");
  if (!scrollEl || !inner || ignoreStickyToInner) return;
  ignoreInnerToSticky = true;
  inner.scrollLeft = scrollEl.scrollLeft;
  requestAnimationFrame(() => {
    ignoreInnerToSticky = false;
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
  const scrollEl = document.getElementById(SCROLL_ID);
  const section = document.getElementById("section-all");
  const table = document.getElementById("ordersTable");
  if (!wrap || !scrollEl || !table) return;

  if (!section?.classList.contains("active")) {
    wrap.hidden = true;
    wrap.setAttribute("aria-hidden", "true");
    return;
  }

  const thead = table.querySelector("thead");
  if (!thead) return;

  const tableRect = table.getBoundingClientRect();
  const theadRect = thead.getBoundingClientRect();
  const vh = window.innerHeight;

  if (tableRect.bottom <= 0 || tableRect.top >= vh) {
    wrap.hidden = true;
    wrap.setAttribute("aria-hidden", "true");
    return;
  }

  const stickTop = getTopbarStickyOffset();
  const shouldShow = theadRect.top < stickTop;

  if (!shouldShow) {
    wrap.hidden = true;
    wrap.setAttribute("aria-hidden", "true");
    return;
  }

  wrap.hidden = false;
  wrap.style.top = `${stickTop}px`;
  wrap.setAttribute("aria-hidden", "false");
  positionStickyWrap(wrap);
  syncScrollLeftFromInner();
  syncStickyColumnWidths();
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
  const scrollEl = document.getElementById(SCROLL_ID);
  if (!wrap || !scrollEl) return;

  refreshOrdersTableStickyClone();

  wrap.addEventListener(
    "click",
    (e) => {
      const btn = e.target.closest(".status-filter-btn");
      if (!btn || !wrap.contains(btn)) return;
      e.preventDefault();
      document.getElementById("statusFilterBtn")?.click();
    },
    true
  );

  scrollEl.addEventListener(
    "scroll",
    () => {
      syncScrollLeftToInner();
    },
    { passive: true }
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
        syncScrollLeftFromInner();
        scheduleOrdersStickyHeaderUpdate();
      },
      { passive: true }
    );
  }

  scheduleOrdersStickyHeaderUpdate();
}

/** После перерисовки строк — пересчитать ширины и видимость клона. */
export function refreshOrdersTableStickyHeader() {
  scheduleOrdersStickyHeaderUpdate();
}
