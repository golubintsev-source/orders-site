import { checkAuth, loadProfile, hydrateCachedRoleFromStorage, logout } from "./auth.js";
import { state } from "./state.js";
import { setMessage } from "./dom.js";
import {
  initSectionNavDropdown, refreshSectionNavAfterProfile, switchSection,
  syncOrdersSearchIconAccent, getCurrentSectionId,
} from "./section-nav.js";
import { canAccessSection } from "./roles.js";
import {
  getOrderIdFromUrl, getOrderEditIdFromUrl, getRouteSectionFromUrl, migrateLegacyHashToPathIfNeeded,
  tryConsumeOrdersExcelExport,
} from "./app-routes.js";
import { flushPendingAccessLogs, initAccessLogging } from "./access-log.js";
import {
  applySavedScroll, captureHref, consumeSkipUserPlaceResume, getResumeHref,
  initUserPlaceTracking, readSavedPlaceForCurrentPage, readUserPlace,
  scheduleSaveUserPlace, shouldRedirectToSavedPlace,
} from "./user-place.js";
import { trySecretLoginFromUrl, getLoginKeyFromUrl } from "./secret-login.js";
import { updateTopbarUserName } from "./user-names.js";
import { initNavigationHistory, readNavigationState, restoreNavigationScroll, beginNavigationRestore, endNavigationRestore, updateNavigationBackButton } from "./navigation-history.js";

async function restoreHistoryFilters(snapshot) {
  if (snapshot?.sectionId !== "section-calculations" || !snapshot.extra?.calculations) return;
  const calculations = await import("./calculations.js");
  calculations.restoreCalculationsView(snapshot.extra.calculations);
}

async function navigateFromMenu(id) {
  if (state.viewingOrderId != null || state.editingOrderId != null) {
    const orders = await import("./orders.js");
    if (id !== "new") {
      orders.leaveOrderFormToSection(id);
      return;
    }
    orders.resetFormMode();
  }
  await switchSection(id);
}

function bindOrderEditLinks() {
  let openingOrder = false;
  document.getElementById("appContainer")?.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest(".content-section a[href]");
    if (!link || link.origin !== location.origin || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
    const orderId = getOrderEditIdFromUrl(link);
    if (orderId == null || getCurrentSectionId() === "new") return;

    event.preventDefault();
    if (openingOrder) return;
    openingOrder = true;
    const sourceUrl = location.href;
    const row = link.closest("#calculationsTable tr[data-calculation-id]");
    const navigationAnchor = row && {
      calculationId: row.dataset.calculationId,
      top: row.getBoundingClientRect().top,
    };
    const sourceSection = getCurrentSectionId();
    const isCurrent = () => location.href === sourceUrl && getCurrentSectionId() === sourceSection;
    void import("./orders-runtime.js").then((runtime) => runtime.ensureOrdersUI()).then((orders) => {
      if (isCurrent()) return orders.editOrder(orderId, { navigationAnchor, isCurrent });
    }).catch(reportError).finally(() => { openingOrder = false; });
  });
}

function bindShell() {
  bindOrderEditLinks();
  initSectionNavDropdown({ onSectionItemSelect: (id) => {
    void navigateFromMenu(id).catch(reportError);
  } });
  document.getElementById("logoutBtn")?.addEventListener("click", logout);
  document.getElementById("backToOrdersBtn")?.addEventListener("click", () => {
    void navigateFromMenu("all").catch(reportError);
  });
  // Outside orders, the magnifier is a shortcut to orders, not an order-module dependency.
  document.getElementById("ordersSearchOpenBtn")?.addEventListener("click", () => {
    if (getCurrentSectionId() !== "all" && !window.__ordersUiReady) {
      void navigateFromMenu("all").catch(reportError);
    }
  });
}

function reportError(error) {
  console.error("Ошибка инициализации:", error);
  void window.__appStartup?.fail();
  setMessage("Не удалось загрузить раздел. Проверьте соединение и откройте его снова.", "#d32f2f");
}

function ensureBootOrFallback() {
  if (document.documentElement.hasAttribute("data-route-boot")) return;
  document.querySelectorAll(".container > section.content-section").forEach((el) => el.classList.remove("active"));
  document.getElementById("section-all")?.classList.add("active");
  document.documentElement.setAttribute("data-route-boot", "1");
}

function restoreSearch(app) {
  const pending = sessionStorage.getItem("pendingOrdersSearch");
  const value = pending ?? (app?.sectionId === "all" ? app.clientSearch : null);
  if (value == null) return;
  sessionStorage.removeItem("pendingOrdersSearch");
  const input = document.getElementById("clientSearch");
  if (input) input.value = value;
  syncOrdersSearchIconAccent();
}

async function openRoute({ savedApp = null, initial = false } = {}) {
  const editOrderId = getOrderEditIdFromUrl();
  const orderId = editOrderId == null ? getOrderIdFromUrl() : null;
  let sectionId = getRouteSectionFromUrl();
  if (savedApp?.sectionId && canAccessSection(savedApp.sectionId)) sectionId = savedApp.sectionId;
  if (!canAccessSection(sectionId)) sectionId = "all";
  const savedForm = savedApp?.sectionId == null || savedApp?.sectionId === "new";
  const viewId = orderId ?? (savedForm ? savedApp?.viewingOrderId : null);
  const editId = editOrderId ?? (viewId == null && savedForm ? savedApp?.editingOrderId : null);
  window.__appStartup?.expectSection(viewId != null || editId != null ? "new" : sectionId);
  restoreSearch(savedApp);
  if (savedApp?.sectionId === "order-tasks") state.tasksOrderId = savedApp.tasksOrderId;
  if (viewId != null || editId != null) {
    const runtime = await import("./orders-runtime.js");
    const orders = await runtime.ensureOrdersUI();
    if (viewId != null) await orders.viewOrder(viewId);
    else await orders.editOrder(editId, { skipUrlSync: true });
  } else {
    if (state.viewingOrderId != null || state.editingOrderId != null) {
      const orders = await import("./orders.js");
      orders.resetFormMode();
    }
    await switchSection(sectionId, {
      skipUrlSync: true, logInitialAccess: initial, restoreMessagesChat: true,
    });
  }
  migrateLegacyHashToPathIfNeeded();
  tryConsumeOrdersExcelExport(canAccessSection("orders-excel"));
  scheduleSaveUserPlace();
}

async function init() {
  ensureBootOrFallback();
  if (typeof navigator !== "undefined" && navigator.onLine === false && window.__appStartup) {
    void window.__appStartup.fail();
    return;
  }
  initAccessLogging();
  if (getLoginKeyFromUrl() && await trySecretLoginFromUrl()) {
    // Successful link login navigates away; failed link login must expose retry.
    void window.__appStartup?.fail();
    return;
  }
  const user = await checkAuth();
  if (!user) return;
  updateTopbarUserName(user.email);
  void flushPendingAccessLogs(user);
  initUserPlaceTracking(user.id, {
    getAppContext: () => {
      const sectionId = getCurrentSectionId();
      return {
        sectionId,
        viewingOrderId: sectionId === "new" ? state.viewingOrderId : null,
        editingOrderId: sectionId === "new" ? state.editingOrderId : null,
        tasksOrderId: state.tasksOrderId,
        clientSearch: (document.getElementById("clientSearch")?.value || "").trim() || undefined,
      };
    },
  });
  initNavigationHistory({
    capture: () => ({
      calculations: document.getElementById("section-calculations")?.classList.contains("active")
        ? window.__captureCalculationsView?.() : null,
    }),
  });
  const historySnapshot = readNavigationState();
  const startupRestoration = historySnapshot && beginNavigationRestore();
  await restoreHistoryFilters(historySnapshot);
  const saved = readSavedPlaceForCurrentPage(user.id);
  const skipResume = consumeSkipUserPlaceResume();
  if (!historySnapshot && !skipResume && !saved && shouldRedirectToSavedPlace(captureHref(), readUserPlace(user.id)?.href)) {
    window.location.replace(getResumeHref(user.id, captureHref()));
    return;
  }
  hydrateCachedRoleFromStorage();
  // Early chat boot stays independent of order data, settings and the profile request.
  const messagesFirst = getRouteSectionFromUrl() === "messages" && (!saved?.app?.sectionId || saved.app.sectionId === "messages");
  const routeReady = messagesFirst ? openRoute({ initial: true }) : null;
  // Attach immediately even when the profile request is still pending.
  routeReady?.catch(() => {});
  await loadProfile();
  refreshSectionNavAfterProfile();
  bindShell();
  window.addEventListener("popstate", () => {
    const snapshot = readNavigationState();
    const restoration = beginNavigationRestore();
    void (async () => {
      await restoreHistoryFilters(snapshot);
      await openRoute();
      await restoreNavigationScroll(snapshot, restoration);
      updateNavigationBackButton();
    })().catch((error) => { endNavigationRestore(restoration); reportError(error); });
  });
  if (routeReady) await routeReady;
  else await openRoute({ savedApp: skipResume ? null : saved?.app, initial: true });
  await window.__appStartup?.complete();
  if (historySnapshot) await restoreNavigationScroll(historySnapshot, startupRestoration);
  else await applySavedScroll(saved);
  void import("./nav-status.js").then((m) => m.initNavStatus()).catch(console.error);
  void import("./push-notifications.js").then((m) => m.initPushNotifications()).catch(console.error);
}

void init().catch(reportError);
