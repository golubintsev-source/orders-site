import { checkAuth, loadProfile } from "./auth.js";
import { bindUIEvents, toggleOrderRowHighlightById } from "./ui.js";
import { loadOrders, resetFormMode, editOrder, deleteOrder } from "./orders.js";
import { initCalculationsSection } from "./calculations.js";
import { initBalanceSection } from "./balance.js";
import { loadSettings } from "./settings.js";
import { openFilesModal, removeFile } from "./files.js";
import { userInfo } from "./dom.js";
import { setMessage } from "./dom.js";

window.editOrder = editOrder;
window.deleteOrder = deleteOrder;
window.openFilesModal = openFilesModal;
window.removeFile = removeFile;
window.toggleOrderRowHighlightById = toggleOrderRowHighlightById;

async function init() {
  bindUIEvents();

  try {
    const user = await checkAuth();
    if (!user) return;

    if (userInfo && user.email) {
      userInfo.textContent = user.email;
    }
    await loadProfile();
    await loadSettings();
    await loadOrders();
    resetFormMode();
    await initCalculationsSection();
    await initBalanceSection();
  } catch (err) {
    console.error("Ошибка инициализации:", err);
    setMessage("Ошибка подключения к базе. Проверьте интернет и настройки Supabase.", "#d32f2f");
  }
}

init();