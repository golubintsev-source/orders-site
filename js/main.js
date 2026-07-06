import { checkAuth, loadProfile, hydrateCachedRoleFromStorage } from "./auth.js";
import { state } from "./state.js";
import { bindUIEvents, toggleOrderRowHighlightById } from "./ui.js";
import {
  loadOrders,
  paintOrdersFromSessionCacheIfAny,
  resetFormMode,
  editOrder,
  viewOrder,
  deleteOrder,
} from "./orders.js";
import { bindCalculationsSection, loadCalculations } from "./calculations.js";
import { initRouteSheetSection } from "./route-sheet.js";
import { loadSettings } from "./settings.js";
import { initOrderTasksSection } from "./tasks.js";
import { initAllChangesSection } from "./all-changes.js";
import { initStatisticsSection } from "./statistics.js";
import { openFilesModal, removeFile } from "./files.js";
import { setMessage } from "./dom.js";
import { initOrdersTableStickyHeader } from "./ordersTableStickyHeader.js";
import { initOrdersTableMobileFit } from "./ordersTableMobileFit.js";
import { initOrdersTablePinchZoom } from "./ordersTablePinchZoom.js";
import {
  refreshSectionNavAfterProfile,
  switchSection,
  syncOrdersSearchIconAccent,
  getCurrentSectionId,
} from "./section-nav.js";
import { canAccessSection } from "./roles.js";
import { applyClientFilter } from "./orders.js";
import {
  getRouteSectionFromUrl,
  migrateLegacyHashToPathIfNeeded,
  tryConsumeOrdersExcelExport,
} from "./app-routes.js";
import {
  flushPendingAccessLogs,
  initAccessLogging,
} from "./access-log.js";
import {
  applySavedScroll,
  captureHref,
  getResumeHref,
  initUserPlaceTracking,
  readSavedPlaceForCurrentPage,
  readUserPlace,
  scheduleSaveUserPlace,
  shouldRedirectToSavedPlace,
} from "./user-place.js";
import { initPushNotifications } from "./push-notifications.js";
import { initMessagesSection } from "./messages.js";

window.editOrder = editOrder;
window.viewOrder = viewOrder;
window.deleteOrder = deleteOrder;
window.openFilesModal = openFilesModal;
window.removeFile = removeFile;
window.toggleOrderRowHighlightById = toggleOrderRowHighlightById;

/** Если boot-route.js не выполнился, снять «вечную» скрытость разделов из style.css. */
function ensureBootOrFallback() {
  if (document.documentElement.hasAttribute("data-route-boot")) return;
  document.querySelectorAll(".container > section.content-section").forEach((el) => {
    el.classList.remove("active");
  });
  document.getElementById("section-all")?.classList.add("active");
  document.documentElement.setAttribute("data-route-boot", "1");
}

async function init() {
  ensureBootOrFallback();
  bindUIEvents();
  initOrdersTableStickyHeader();
  initOrdersTableMobileFit();
  initOrdersTablePinchZoom();
  initAccessLogging();

  try {
    const user = await checkAuth();
    if (!user) return;

    void flushPendingAccessLogs(user);

    initUserPlaceTracking(user.id, {
      getAppContext: () => ({
        sectionId: getCurrentSectionId(),
        viewingOrderId: state.viewingOrderId,
        editingOrderId: state.editingOrderId,
        tasksOrderId: state.tasksOrderId,
        clientSearch: (document.getElementById("clientSearch")?.value || "").trim() || undefined,
      }),
    });

    const savedPlace = readSavedPlaceForCurrentPage(user.id);
    if (!savedPlace && shouldRedirectToSavedPlace(captureHref(), readUserPlace(user.id)?.href)) {
      window.location.replace(getResumeHref(user.id, captureHref()));
      return;
    }

    hydrateCachedRoleFromStorage();
    paintOrdersFromSessionCacheIfAny();

    const ordersPromise = loadOrders();

    await Promise.all([loadProfile(), loadSettings()]);
    refreshSectionNavAfterProfile();
    void initPushNotifications();
    applyRouteOnLoad();
    ensurePopstateRouting();

    await ordersPromise;

    initOrderTasksSection();
    initMessagesSection();

    const savedApp = readSavedPlaceForCurrentPage(user.id)?.app;
    const restoringOrderForm =
      savedApp?.viewingOrderId != null || savedApp?.editingOrderId != null;
    if (!restoringOrderForm) {
      resetFormMode();
    }

    if (canAccessSection("calculations")) {
      bindCalculationsSection();
      if (getCurrentSectionId() === "calculations") {
        void loadCalculations();
      }
    }
    initRouteSheetSection();
    initAllChangesSection();
    initStatisticsSection();

    applyPendingOrdersSearchFromHistory();
    await restoreSavedAppContext(user.id);
    await applySavedScroll(readSavedPlaceForCurrentPage(user.id));
  } catch (err) {
    console.error("Ошибка инициализации:", err);
    setMessage("Ошибка подключения к базе. Проверьте интернет и настройки Supabase.", "#d32f2f");
    if (state.currentUser) {
      try {
        await loadOrders();
      } catch (e2) {
        console.error("Повторная загрузка заказов:", e2);
      }
    }
  }
}

function applyRouteOnLoad() {
  tryConsumeOrdersExcelExport(canAccessSection("orders-excel"));

  let sectionId = getRouteSectionFromUrl();
  if (!canAccessSection(sectionId)) sectionId = "all";
  switchSection(sectionId, { skipUrlSync: true, logInitialAccess: true });
  migrateLegacyHashToPathIfNeeded();
}

let popstateRoutingBound = false;

function ensurePopstateRouting() {
  if (popstateRoutingBound) return;
  popstateRoutingBound = true;
  window.addEventListener("popstate", () => {
    if (!document.getElementById("ordersTable")) return;
    let sectionId = getRouteSectionFromUrl();
    if (!canAccessSection(sectionId)) sectionId = "all";
    switchSection(sectionId, { skipUrlSync: true });
  });
}

function applyPendingOrdersSearchFromHistory() {
  const pending = sessionStorage.getItem("pendingOrdersSearch");
  if (pending == null) return;
  sessionStorage.removeItem("pendingOrdersSearch");
  const el = document.getElementById("clientSearch");
  if (el) {
    el.value = pending;
    applyClientFilter();
    syncOrdersSearchIconAccent();
  }
}

async function restoreSavedAppContext(userId) {
  const saved = readSavedPlaceForCurrentPage(userId);
  const app = saved?.app;
  if (!app) return;

  if (app.clientSearch && app.sectionId === "all" && !sessionStorage.getItem("pendingOrdersSearch")) {
    const el = document.getElementById("clientSearch");
    if (el && !el.value.trim()) {
      el.value = app.clientSearch;
      applyClientFilter();
      syncOrdersSearchIconAccent();
    }
  }

  if (app.viewingOrderId != null) {
    await viewOrder(app.viewingOrderId);
    scheduleSaveUserPlace();
    return;
  }
  if (app.editingOrderId != null) {
    await editOrder(app.editingOrderId);
    scheduleSaveUserPlace();
    return;
  }

  if (app.sectionId === "order-tasks" && app.tasksOrderId != null) {
    state.tasksOrderId = app.tasksOrderId;
    switchSection("order-tasks", { skipUrlSync: true });
    await import("./tasks.js").then((m) => m.loadOrderTasks());
    scheduleSaveUserPlace();
    return;
  }

  if (
    app.sectionId &&
    app.sectionId !== getCurrentSectionId() &&
    canAccessSection(app.sectionId)
  ) {
    switchSection(app.sectionId, { skipUrlSync: true });
    scheduleSaveUserPlace();
  }
}

init();