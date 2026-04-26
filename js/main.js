import { checkAuth, loadProfile } from "./auth.js";
import { bindUIEvents, toggleOrderRowHighlightById } from "./ui.js";
import { loadOrders, resetFormMode, editOrder, viewOrder, deleteOrder, applyOrderTypeSelectForRole } from "./orders.js";
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

async function init() {
  bindUIEvents();
  initOrdersTableStickyHeader();
  initOrdersTableMobileFit();
  initOrdersTablePinchZoom();

  try {
    const user = await checkAuth();
    if (!user) return;

    await loadProfile();
    refreshSectionNavAfterProfile();
    applyOrderTypeSelectForRole();
    await loadSettings();
    await loadOrders();
    initOrderTasksSection();
    resetFormMode();
    if (canAccessSection("calculations")) {
      await initCalculationsSection();
    }
    await initBalanceSection();
    initRouteSheetSection();
    initAllChangesSection();

    applyRouteOnLoad();
    ensurePopstateRouting();
    applyPendingOrdersSearchFromHistory();
  } catch (err) {
    console.error("Ошибка инициализации:", err);
    setMessage("Ошибка подключения к базе. Проверьте интернет и настройки Supabase.", "#d32f2f");
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