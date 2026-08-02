/**
 * Pull-to-refresh for iPhone (and iPad) installed PWA.
 * Native Safari reload is unavailable in standalone mode, and nested
 * scroll areas (orders table) block document overscroll — so we add
 * a custom gesture: pull down at the top → white strip + spinner → reload.
 */
(() => {
  function isIos() {
    const ua = navigator.userAgent || "";
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    // iPadOS 13+ can report as Mac with touch
    return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  }

  function isStandalonePwa() {
    if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
    if (window.navigator.standalone === true) return true;
    return false;
  }

  function forceEnabled() {
    try {
      if (new URLSearchParams(window.location.search).get("ptr") === "1") return true;
      if (window.localStorage?.getItem("iosPtrDebug") === "1") return true;
    } catch {
      /* ignore */
    }
    return false;
  }

  // Production: only iOS/iPadOS installed PWA. `?ptr=1` / localStorage iosPtrDebug=1 for QA.
  if (!forceEnabled() && (!isIos() || !isStandalonePwa())) return;

  const MAX_PULL = 96;
  const TRIGGER_PULL = 62;
  const SETTLE_PULL = 56;
  const RESISTANCE = 0.42;

  let indicator = null;
  let startY = 0;
  let startX = 0;
  let pulling = false;
  let armed = false;
  let refreshing = false;
  let currentPull = 0;
  let scrollRoot = null;
  let ignoreTouch = false;

  function injectStyles() {
    if (document.getElementById("iosPullToRefreshStyles")) return;
    const style = document.createElement("style");
    style.id = "iosPullToRefreshStyles";
    style.textContent = `
      #iosPullToRefresh {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: 0;
        overflow: hidden;
        background: #fff;
        z-index: 2147483000;
        pointer-events: none;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: none;
      }
      #iosPullToRefresh .ios-ptr__spinner {
        width: 22px;
        height: 22px;
        border: 2.5px solid #d1d5db;
        border-top-color: #2563eb;
        border-radius: 50%;
        opacity: 0;
        transform: scale(0.85);
        transition: opacity 0.12s ease, transform 0.12s ease;
      }
      #iosPullToRefresh.is-pulling .ios-ptr__spinner {
        opacity: 0.55;
        transform: scale(0.92);
        animation: ios-ptr-spin 0.85s linear infinite;
      }
      #iosPullToRefresh.is-armed .ios-ptr__spinner,
      #iosPullToRefresh.is-refreshing .ios-ptr__spinner {
        opacity: 1;
        transform: scale(1);
        animation: ios-ptr-spin 0.75s linear infinite;
      }
      @keyframes ios-ptr-spin {
        to { transform: rotate(360deg); }
      }
      html.ios-ptr-lock,
      html.ios-ptr-lock body {
        overscroll-behavior-y: none;
        touch-action: pan-x;
      }
      body.ios-ptr-dragging {
        transition: none !important;
      }
      body.ios-ptr-settling {
        transition: transform 0.22s ease-out !important;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureIndicator() {
    if (indicator) return indicator;
    injectStyles();
    indicator = document.createElement("div");
    indicator.id = "iosPullToRefresh";
    indicator.setAttribute("aria-hidden", "true");
    indicator.innerHTML = '<div class="ios-ptr__spinner" aria-hidden="true"></div>';
    // Attach to <html>, not <body>: body is translated down during the pull,
    // while the white strip must stay pinned to the top of the screen.
    document.documentElement.appendChild(indicator);
    return indicator;
  }

  function isEditableTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    if (target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']")) {
      return true;
    }
    return false;
  }

  function isScrollableY(el) {
    if (!(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    const oy = style.overflowY;
    if (oy !== "auto" && oy !== "scroll" && oy !== "overlay") return false;
    return el.scrollHeight > el.clientHeight + 1;
  }

  function findScrollRoot(start) {
    let el = start instanceof Element ? start : null;
    while (el && el !== document.body && el !== document.documentElement) {
      if (isScrollableY(el)) return el;
      el = el.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function getScrollTop(el) {
    if (
      !el ||
      el === document.scrollingElement ||
      el === document.documentElement ||
      el === document.body
    ) {
      return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    }
    return el.scrollTop;
  }

  function atScrollTop(el) {
    return getScrollTop(el) <= 0;
  }

  function applyPull(pull, { settling = false } = {}) {
    currentPull = Math.max(0, pull);
    const el = ensureIndicator();
    el.style.height = `${currentPull}px`;
    document.body.style.transform = currentPull ? `translate3d(0, ${currentPull}px, 0)` : "";
    document.body.classList.toggle("ios-ptr-dragging", !settling && currentPull > 0 && !refreshing);
    document.body.classList.toggle("ios-ptr-settling", settling);
    document.documentElement.classList.toggle("ios-ptr-lock", currentPull > 0 || refreshing);

    armed = !refreshing && currentPull >= TRIGGER_PULL;
    el.classList.toggle("is-pulling", currentPull > 14 && !refreshing);
    el.classList.toggle("is-armed", armed);
    el.classList.toggle("is-refreshing", refreshing);
  }

  function resetPull() {
    refreshing = false;
    armed = false;
    pulling = false;
    scrollRoot = null;
    applyPull(0, { settling: true });
    window.setTimeout(() => {
      if (currentPull === 0 && !refreshing) {
        document.body.classList.remove("ios-ptr-settling", "ios-ptr-dragging");
        document.documentElement.classList.remove("ios-ptr-lock");
        document.body.style.transform = "";
        if (indicator) {
          indicator.style.height = "0px";
          indicator.classList.remove("is-pulling", "is-armed", "is-refreshing");
        }
      }
    }, 240);
  }

  function startRefresh() {
    refreshing = true;
    pulling = false;
    applyPull(SETTLE_PULL, { settling: true });
    ensureIndicator().classList.add("is-refreshing");
    // Let the strip settle with the spinner visible, then hard-reload.
    window.setTimeout(() => {
      try {
        window.location.reload();
      } catch {
        window.location.href = window.location.href;
      }
    }, 180);
  }

  function isElementVisible(el) {
    if (!el || el.hasAttribute("hidden")) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return true;
  }

  function hasOpenOverlay() {
    if (document.querySelector("dialog[open]")) return true;
    const candidates = document.querySelectorAll(
      '[role="dialog"], #filesModal, .files-modal, .crop-image-modal, .spreadsheet-viewer-modal',
    );
    for (const el of candidates) {
      if (isElementVisible(el)) return true;
    }
    return false;
  }

  function onTouchStart(event) {
    if (refreshing) return;
    if (event.touches.length !== 1) {
      ignoreTouch = true;
      return;
    }
    ignoreTouch = false;
    const touch = event.touches[0];
    const target = event.target;
    if (isEditableTarget(target) || hasOpenOverlay()) {
      ignoreTouch = true;
      return;
    }
    scrollRoot = findScrollRoot(target);
    if (!atScrollTop(scrollRoot)) {
      ignoreTouch = true;
      return;
    }
    startY = touch.clientY;
    startX = touch.clientX;
    pulling = false;
    armed = false;
  }

  function onTouchMove(event) {
    if (refreshing || ignoreTouch) return;
    if (event.touches.length !== 1) {
      if (pulling) resetPull();
      ignoreTouch = true;
      return;
    }
    if (!scrollRoot) return;

    const touch = event.touches[0];
    const dy = touch.clientY - startY;
    const dx = touch.clientX - startX;

    if (!pulling) {
      if (dy < 8) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        ignoreTouch = true;
        return;
      }
      if (!atScrollTop(scrollRoot)) {
        ignoreTouch = true;
        return;
      }
      pulling = true;
      ensureIndicator();
    }

    if (!pulling) return;

    // Resist so it feels rubber-band-like; clamp to MAX_PULL.
    const pull = Math.min(MAX_PULL, dy * RESISTANCE);
    if (pull > 0) {
      if (event.cancelable) event.preventDefault();
      applyPull(pull);
    } else {
      applyPull(0);
    }
  }

  function onTouchEnd() {
    if (refreshing) return;
    if (!pulling) {
      ignoreTouch = false;
      scrollRoot = null;
      return;
    }
    if (currentPull >= TRIGGER_PULL) {
      startRefresh();
    } else {
      resetPull();
    }
    ignoreTouch = false;
    scrollRoot = null;
  }

  function onTouchCancel() {
    if (refreshing) return;
    if (pulling) resetPull();
    ignoreTouch = false;
    scrollRoot = null;
  }

  function bind() {
    ensureIndicator();
    document.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true, capture: true });
    document.addEventListener("touchcancel", onTouchCancel, { passive: true, capture: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind, { once: true });
  } else {
    bind();
  }
})();
