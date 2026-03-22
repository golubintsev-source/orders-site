import { checkAuth, loadProfile } from "./auth.js";
import { bindUIEvents, toggleOrderRowHighlightById } from "./ui.js";
import { loadOrders, resetFormMode, editOrder, deleteOrder, applyOrderTypeSelectForRole } from "./orders.js";
import { initCalculationsSection } from "./calculations.js";
import { initBalanceSection } from "./balance.js";
import { loadSettings } from "./settings.js";
import { initOrderTasksSection } from "./tasks.js";
import { openFilesModal, removeFile } from "./files.js";
import { setMessage } from "./dom.js";
import { initOrdersTableStickyHeader } from "./ordersTableStickyHeader.js";
import {
  refreshSectionNavAfterProfile,
  switchSection,
  syncOrdersSearchIconAccent,
} from "./section-nav.js";
import { canAccessSection } from "./roles.js";
import { applyClientFilter } from "./orders.js";

window.editOrder = editOrder;
window.deleteOrder = deleteOrder;
window.openFilesModal = openFilesModal;
window.removeFile = removeFile;
window.toggleOrderRowHighlightById = toggleOrderRowHighlightById;

async function init() {
  bindUIEvents();
  initOrdersTableStickyHeader();

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

    applyHashSection();
    applyPendingOrdersSearchFromHistory();
  } catch (err) {
    console.error("Ошибка инициализации:", err);
    setMessage("Ошибка подключения к базе. Проверьте интернет и настройки Supabase.", "#d32f2f");
  }
}

const HASH_SECTION_IDS = new Set(["all", "new", "calculations", "tasks-all", "balance", "settings"]);

function applyHashSection() {
  const h = window.location.hash.replace(/^#/, "");
  if (!h) return;
  if (!HASH_SECTION_IDS.has(h) || !canAccessSection(h)) return;
  switchSection(h);
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