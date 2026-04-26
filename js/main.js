import { checkAuth, loadProfile, hydrateCachedRoleFromStorage } from "./auth.js";
import { state } from "./state.js";
import { bindUIEvents, toggleOrderRowHighlightById } from "./ui.js";
import {
  loadOrders,
  paintOrdersFromLocalStorageIfAny,
  resetFormMode,
  editOrder,
  viewOrder,
  deleteOrder,
  applyOrderTypeSelectForRole,
} from "./orders.js";
import { initCalculationsSection } from "./calculations.js";
import { initBalanceSection } from "./balance.js";
import { initRouteSheetSection } from "./route-sheet.js";
import { loadSettings } from "./settings.js";
import { initOrderTasksSection } from "./tasks.js";
import { initAllChangesSection } from "./all-changes.js";
import { openFilesModal, removeFile } from "./files.js";
import { setMessage } from "./dom.js";
import { initOrdersTableStickyHeader } from "./ordersTableStickyHeader.js";
import { initOrdersTableMobileFit } from "./ordersTableMobileFit.js";
import { initOrdersTablePinchZoom } from "./ordersTablePinchZoom.js";
import {
  refreshSectionNavAfterProfile,
  switchSection,
  syncOrdersSearchIconAccent,
} from "./section-nav.js";
import { initDbPingIndicator } from "./db-ping.js";
import { canAccessSection } from "./roles.js";
import { applyClientFilter } from "./orders.js";
import {
  getRouteSectionFromUrl,
  migrateLegacyHashToPathIfNeeded,
  tryConsumeOrdersExcelExport,
} from "./app-routes.js";

window.editOrder = editOrder;
window.viewOrder = viewOrder;
window.deleteOrder = deleteOrder;
window.openFilesModal = openFilesModal;
window.removeFile = removeFile;
window.toggleOrderRowHighlightById = toggleOrderRowHighlightById;

/** Safari: при возврате из bfcache скрипт init не выполняется повторно — подтянуть таблицу из localStorage. */
window.addEventListener("pageshow", (e) => {
  if (!e.persisted) return;
  void import("./orders.js").then((m) => m.paintOrdersFromLocalStorageIfAny());
});

/** Если boot-route.js не выполнился (сеть), снять «вечную» скрытость разделов из style.css. */
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

  try {
    const user = await checkAuth();
    if (!user) return;

    hydrateCachedRoleFromStorage();
    paintOrdersFromLocalStorageIfAny();

    await Promise.all([loadProfile(), loadSettings()]);
    initDbPingIndicator();
    refreshSectionNavAfterProfile();
    applyOrderTypeSelectForRole();
    applyRouteOnLoad();
    ensurePopstateRouting();

    await loadOrders();
    initOrderTasksSection();
    resetFormMode();
    if (canAccessSection("calculations")) {
      await initCalculationsSection();
    }
    await initBalanceSection();
    initRouteSheetSection();
    initAllChangesSection();

    applyPendingOrdersSearchFromHistory();
  } catch (err) {
    console.error("Ошибка инициализации:", err);
    setMessage("Ошибка подключения к базе. Проверьте интернет и настройки Supabase.", "#d32f2f");
    if (state.currentUser) {
      try {
        await loadOrders();
      } catch (e2) {
        console.error("Повторная загрузка заказов из кэша:", e2);
      }
    }
  }
}

function applyRouteOnLoad() {
  tryConsumeOrdersExcelExport(canAccessSection("orders-excel"));

  let sectionId = getRouteSectionFromUrl();
  if (!canAccessSection(sectionId)) sectionId = "all";
  switchSection(sectionId, { skipUrlSync: true });
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

init();