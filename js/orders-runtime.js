import { state } from "./state.js";

let uiPromise = null;
let settingsPromise = null;
let dataPromise = null;

export function ensureOrderSettings() {
  if (!settingsPromise) {
    settingsPromise = import("./settings.js").then((m) => m.loadSettings())
      .catch((error) => { settingsPromise = null; throw error; });
  }
  return settingsPromise;
}

/** Bind order-specific controls only when an order screen/action actually needs them. */
export function ensureOrdersUI() {
  if (!uiPromise) {
    uiPromise = Promise.all([
      import("./orders.js"), import("./ui.js"), import("./files.js"),
      import("./ordersTableStickyHeader.js"), import("./ordersTableMobileFit.js"),
      import("./ordersTablePinchZoom.js"), import("./orders-address-column-width.js"),
    ]).then(([orders, ui, files, sticky, fit, zoom, width]) => {
      ui.bindUIEvents();
      window.__ordersUiReady = true;
      sticky.initOrdersTableStickyHeader();
      fit.initOrdersTableMobileFit();
      zoom.initOrdersTablePinchZoom();
      width.initOrdersAddressColumnWidth(state.currentUser);
      window.editOrder = orders.editOrder;
      window.viewOrder = orders.viewOrder;
      window.deleteOrder = orders.deleteOrder;
      window.openFilesModal = files.openFilesModal;
      window.removeFile = files.removeFile;
      window.toggleOrderRowHighlightById = ui.toggleOrderRowHighlightById;
      document.addEventListener("order-settings-updated", () => orders.populateOrderFormInstallerSelect());
      return orders;
    }).catch((error) => { uiPromise = null; throw error; });
  }
  return uiPromise;
}

export async function ensureOrderFormReady() {
  const [orders, tasks] = await Promise.all([
    ensureOrdersUI(), import("./tasks.js"), ensureOrderSettings(),
  ]);
  orders.populateOrderFormInstallerSelect();
  orders.applyMoneyRecipientSelectsForRole();
  tasks.initOrderTasksSection();
  await tasks.ensureOrderPageTaskExecutorsLoaded();
  return orders;
}

/** Full data is needed for reports and an explicit picker, never for merely opening chat. */
export async function ensureOrdersData({ current = () => true, refresh = false } = {}) {
  const orders = await import("./orders.js");
  if (!current()) return;
  if (refresh || !state.ordersFullyLoaded) {
    if (!dataPromise) {
      dataPromise = orders.loadOrders({ full: true, shouldContinue: current })
        .finally(() => { dataPromise = null; });
    }
    await dataPromise;
    // An earlier consumer may have left its screen while we were waiting.
    if (current() && !state.ordersFullyLoaded && !state.ordersFromCache) {
      await orders.loadOrders({ full: true, shouldContinue: current });
      if (current() && !state.ordersFullyLoaded && !state.ordersFromCache) throw new Error("Не удалось загрузить заказы");
    }
  }
  return orders;
}
