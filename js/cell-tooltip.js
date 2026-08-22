import { cellTooltip } from "./dom.js";

let tooltipHideClick = null;
let tooltipHideKey = null;
let activeTooltipClasses = [];

function detachHideListeners() {
  if (!tooltipHideClick) return;
  document.removeEventListener("click", tooltipHideClick);
  document.removeEventListener("touchend", tooltipHideClick);
  document.removeEventListener("keydown", tooltipHideKey);
  tooltipHideClick = tooltipHideKey = null;
}

function parseTooltipClasses(raw) {
  return String(raw || "")
    .split(/\s+/)
    .filter(Boolean);
}

export function isFloatingCellTooltipVisible() {
  return Boolean(cellTooltip && cellTooltip.classList.contains("visible"));
}

/** Возвращает true, если подсказка была открыта и закрылась этим вызовом. */
export function hideFloatingCellTooltip() {
  if (!tooltipHideClick) return false;
  tooltipHideClick();
  return true;
}

export function showFloatingCellTooltip(anchorEl, text, opts) {
  opts = opts || {};
  const useHtml = Boolean(opts.html);
  if (!cellTooltip || !anchorEl || (!text && !useHtml)) return;
  detachHideListeners();
  activeTooltipClasses.forEach((c) => cellTooltip.classList.remove(c));
  activeTooltipClasses = parseTooltipClasses(opts.tooltipClass);
  activeTooltipClasses.forEach((c) => cellTooltip.classList.add(c));
  if (useHtml) {
    cellTooltip.innerHTML = text;
  } else {
    cellTooltip.textContent = text;
  }
  cellTooltip.classList.add("visible");
  cellTooltip.setAttribute("aria-hidden", "false");
  /*
   * Позиция как у попапа комментария в «Расчётах»: сначала под якорем, иначе над ним; не уезжает за край экрана.
   * Раньше: translateY(-100%) от верха ячейки — на iPhone подсказка часто оказывалась за пределами viewport.
   */
  cellTooltip.style.transform = "none";
  cellTooltip.style.visibility = "hidden";
  cellTooltip.style.left = "0";
  cellTooltip.style.top = "0";
  cellTooltip.style.zIndex = "10050";

  function layoutTooltip() {
    const rect = anchorEl.getBoundingClientRect();
    const margin = 8;
    const tw = cellTooltip.offsetWidth;
    const th = cellTooltip.offsetHeight;
    let left = rect.left;
    if (left + tw > window.innerWidth - margin) left = window.innerWidth - margin - tw;
    if (left < margin) left = margin;
    let top = rect.bottom + margin;
    if (top + th > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - th - margin);
    }
    cellTooltip.style.left = `${Math.round(left)}px`;
    cellTooltip.style.top = `${Math.round(top)}px`;
    cellTooltip.style.visibility = "visible";
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(layoutTooltip);
  });

  function hide() {
    cellTooltip.classList.remove("visible");
    cellTooltip.setAttribute("aria-hidden", "true");
    cellTooltip.textContent = "";
    cellTooltip.innerHTML = "";
    activeTooltipClasses.forEach((c) => cellTooltip.classList.remove(c));
    activeTooltipClasses = [];
    cellTooltip.style.visibility = "";
    cellTooltip.style.left = "";
    cellTooltip.style.top = "";
    cellTooltip.style.transform = "";
    cellTooltip.style.zIndex = "";
    detachHideListeners();
  }
  tooltipHideClick = hide;
  tooltipHideKey = (ev) => {
    if (ev.key === "Escape") hide();
  };
  /* Как в calculations.js: слушатель «снаружи» после текущего клика, без задержки 150ms. */
  setTimeout(() => {
    document.addEventListener("click", tooltipHideClick);
    document.addEventListener("touchend", tooltipHideClick);
    document.addEventListener("keydown", tooltipHideKey);
  }, 0);
}
