import { checkAuth, loadProfile, hydrateCachedRoleFromStorage } from "./auth.js";
import { state } from "./state.js";
import { bindUIEvents, toggleOrderRowHighlightById } from "./ui.js";
import {
  loadOrders,
  resetFormMode,
  editOrder,
  viewOrder,
  deleteOrder,
  populateOrderFormInstallerSelect,
} from "./orders.js";
import { loadSettings } from "./settings.js";
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
import { canAccessSection, isAdmin } from "./roles.js";
import { applyClientFilter } from "./orders.js";
import {
  getOrderIdFromUrl,
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
  consumeSkipUserPlaceResume,
  getResumeHref,
  initUserPlaceTracking,
  readSavedPlaceForCurrentPage,
  readUserPlace,
  scheduleSaveUserPlace,
  shouldRedirectToSavedPlace,
} from "./user-place.js";
import { trySecretLoginFromUrl, getLoginKeyFromUrl } from "./secret-login.js";
import { updateTopbarUserName } from "./user-names.js";

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

/** Простой главного потока; на iOS requestIdleCallback появился только в 16.4. */
function whenIdle(timeout = 2500) {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => resolve(), { timeout });
      return;
    }
    setTimeout(resolve, 1);
  });
}

/**
 * Первый отрисованный список чатов (или таймаут, если раздел не открывался).
 * Вторичные модули весят ~600 КБ и на iPhone заметно отодвигают этот кадр.
 */
function whenChatListPainted(timeoutMs = 5000) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      document.removeEventListener("chat-list-painted", done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    document.addEventListener("chat-list-painted", done, { once: true });
  });
}

/**
 * Тяжёлые разделы вне критического пути заказов.
 * @param {{ urgent?: boolean, after?: Promise<unknown> }} [opts]
 *   urgent — ждать загрузки (сообщения/задачи и т.п.); after — чего дождаться перед стартом.
 */
async function initSecondarySections(opts = {}) {
  const urgent = Boolean(opts.urgent);

  const run = async () => {
    const [
      { bindCalculationsSection, loadCalculations },
      { bindExcessSection, loadExcesses },
      { initRouteSheetSection },
      { initOrderTasksSection },
      { initAllChangesSection },
      { initStatisticsSection },
      { initStatisticsBalanceSection },
      { initPushNotifications },
      { initMessagesSection },
      { initTaskCreateDialog },
      { initVoiceSection },
      { initManagerSalarySection, loadManagerSalary },
    ] = await Promise.all([
      import("./calculations.js"),
      import("./excess.js?v=37"),
      import("./route-sheet.js"),
      import("./tasks.js"),
      import("./all-changes.js"),
      import("./statistics.js"),
      import("./statistics-balance.js"),
      import("./push-notifications.js"),
      import("./messages.js"),
      import("./task-create-dialog.js"),
      import("./voice.js"),
      import("./manager-salary.js"),
    ]);

    void initPushNotifications();
    initOrderTasksSection();
    initTaskCreateDialog();
    initMessagesSection();
    initVoiceSection();
    initManagerSalarySection();
    if (getCurrentSectionId() === "manager-salary") {
      void loadManagerSalary();
    }

    if (canAccessSection("calculations")) {
      bindCalculationsSection();
      if (getCurrentSectionId() === "calculations") {
        void loadCalculations();
      }
    }

    bindExcessSection();
    if (getCurrentSectionId() === "excess") {
      void loadExcesses();
    }

    initRouteSheetSection();
    initAllChangesSection();
    initStatisticsSection();
    initStatisticsBalanceSection();

    if (isAdmin()) {
      const { initLoginLinksSection, loadLoginLinksSection } = await import("./login-links.js");
      initLoginLinksSection();
      void loadLoginLinksSection();
    }
  };

  if (urgent) {
    await run();
    return;
  }

  // Заказы / новый / форма: не ждём ~400 КБ вторичных модулей.
  void Promise.resolve(opts.after)
    .then(() => whenIdle())
    .then(run)
    .catch((err) => console.error("Вторичная инициализация:", err));
}

async function init() {
  ensureBootOrFallback();
  bindUIEvents();
  initOrdersTableStickyHeader();
  initOrdersTableMobileFit();
  initOrdersTablePinchZoom();
  initAccessLogging();

  if (getLoginKeyFromUrl()) {
    const handled = await trySecretLoginFromUrl();
    if (handled) {
      if (!document.getElementById("message")) {
        window.location.href = "login.html";
      }
      return;
    }
  }

  try {
    const user = await checkAuth();
    if (!user) return;

    updateTopbarUserName(user.email);

    void flushPendingAccessLogs(user);

    initUserPlaceTracking(user.id, {
      getAppContext: () => {
        const sectionId = getCurrentSectionId();
        const onOrderForm = sectionId === "new";
        return {
          sectionId,
          // Не сохранять edit/view вне раздела формы — иначе после ухода в «Заказы»
          // restore снова откроет изменение того же заказа.
          viewingOrderId: onOrderForm ? state.viewingOrderId : null,
          editingOrderId: onOrderForm ? state.editingOrderId : null,
          tasksOrderId: state.tasksOrderId,
          clientSearch: (document.getElementById("clientSearch")?.value || "").trim() || undefined,
        };
      },
    });

    const savedPlace = readSavedPlaceForCurrentPage(user.id);
    const skipResume = consumeSkipUserPlaceResume();
    // Не возвращать на history.html / форму заказа, если пользователь явно ушёл через меню.
    if (
      !skipResume &&
      !savedPlace &&
      shouldRedirectToSavedPlace(captureHref(), readUserPlace(user.id)?.href)
    ) {
      window.location.replace(getResumeHref(user.id, captureHref()));
      return;
    }

    hydrateCachedRoleFromStorage();

    // «Чаты» доступны любой роли, поэтому раздел поднимаем до профиля, настроек и заказов:
    // иначе первый запрос списка чатов ждёт лишние round-trip'ы к Supabase.
    const messagesFirst = getRouteSectionFromUrl() === "messages";
    if (messagesFirst) {
      applyRouteOnLoad();
      ensurePopstateRouting();
    }

    // На «Чатах» заказы нужны только компоновщику и фильтру упоминаний — не в первом кадре.
    const ordersPromise = messagesFirst ? whenIdle().then(() => loadOrders()) : loadOrders();

    await Promise.all([loadProfile(), loadSettings()]);
    const { applySettingsAdminBlocksVisibility } = await import("./settings.js");
    applySettingsAdminBlocksVisibility();
    const { populateOrderFormInstallerSelect, applyMoneyRecipientSelectsForRole } = await import("./orders.js");
    populateOrderFormInstallerSelect();
    applyMoneyRecipientSelectsForRole();
    refreshSectionNavAfterProfile();
    if (!messagesFirst) {
      applyRouteOnLoad();
      ensurePopstateRouting();
    }

    const sectionNow = getCurrentSectionId();
    const savedApp = readSavedPlaceForCurrentPage(user.id)?.app;
    const skipAwaitOrders = sectionNow === "messages" || savedApp?.sectionId === "messages";
    if (!skipAwaitOrders) {
      await ordersPromise;
    } else {
      // Для страницы сообщений не блокируем рендер ожиданием загрузки orders — она нужна лишь для компоновщика/фильтров.
      void ordersPromise;
    }

    const orderIdFromUrl = getOrderIdFromUrl();
    const savedOnOrderForm = savedApp?.sectionId == null || savedApp?.sectionId === "new";
    const restoringOrderForm =
      orderIdFromUrl != null ||
      (savedOnOrderForm &&
        (savedApp?.viewingOrderId != null || savedApp?.editingOrderId != null));
    if (!restoringOrderForm) {
      resetFormMode();
    }

    applyPendingOrdersSearchFromHistory();

    // Не блокируем открытие заказа/restore на загрузке messages/voice/route-sheet.
    const waitSecondary =
      sectionNow === "order-tasks" ||
      sectionNow === "tasks-all" ||
      sectionNow === "calculations" ||
      sectionNow === "excess" ||
      sectionNow === "route-sheet" ||
      sectionNow === "changes-all" ||
      sectionNow === "statistics" ||
      sectionNow === "statistics-balance" ||
      sectionNow === "manager-salary" ||
      sectionNow === "balance" ||
      savedApp?.sectionId === "order-tasks";
    if (waitSecondary) {
      await initSecondarySections({ urgent: true });
    } else {
      void initSecondarySections({
        urgent: false,
        after: messagesFirst ? whenChatListPainted() : null,
      });
    }

    if (orderIdFromUrl != null) {
      await viewOrder(orderIdFromUrl);
      scheduleSaveUserPlace();
    } else {
      await restoreSavedAppContext(user.id);
    }
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
  // Если в URL уже есть заказ — лог напишет viewOrder (с order_id), без дубля.
  const hasOrderInUrl = getOrderIdFromUrl() != null;
  switchSection(sectionId, {
    skipUrlSync: true,
    logInitialAccess: !hasOrderInUrl,
  });
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

  // Восстанавливать форму только если сохраняли именно её (раздел «new»).
  // Иначе устаревший editingOrderId после ухода в другой раздел снова «запирает» на изменении.
  if (app.viewingOrderId != null && (app.sectionId == null || app.sectionId === "new")) {
    await viewOrder(app.viewingOrderId);
    scheduleSaveUserPlace();
    return;
  }
  if (app.editingOrderId != null && (app.sectionId == null || app.sectionId === "new")) {
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
