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
import { refreshSectionNavAfterProfile } from "./section-nav.js";
import { canAccessSection } from "./roles.js";

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
  } catch (err) {
    console.error("Ошибка инициализации:", err);
    setMessage("Ошибка подключения к базе. Проверьте интернет и настройки Supabase.", "#d32f2f");
  }
}

init();