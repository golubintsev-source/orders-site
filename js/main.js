import { checkAuth, loadProfile } from "./auth.js";
import { bindUIEvents } from "./ui.js";
import { loadOrders, resetFormMode, editOrder, deleteOrder } from "./orders.js";
import { openFilesModal, removeFile } from "./files.js";
import { userInfo } from "./dom.js";
import { message } from "./dom.js";

window.editOrder = editOrder;
window.deleteOrder = deleteOrder;
window.openFilesModal = openFilesModal;
window.removeFile = removeFile;

async function init() {
  bindUIEvents();

  try {
    const user = await checkAuth();
    if (!user) return;

    if (userInfo && user.email) {
      userInfo.textContent = user.email;
    }
    await loadProfile();
    await loadOrders();
    resetFormMode();
  } catch (err) {
    console.error("Ошибка инициализации:", err);
    if (message) {
      message.textContent = "Ошибка подключения к базе. Проверьте интернет и настройки Supabase.";
      message.style.color = "#b00020";
    }
  }
}

init();