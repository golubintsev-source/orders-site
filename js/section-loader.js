import { createSectionLifecycle } from "./section-lifecycle.js";
import { state } from "./state.js";
import { isAdmin } from "./roles.js";
import { cancelSectionReads } from "./read-requests.js";

async function ordersDependency(current) {
  const runtime = await import("./orders-runtime.js");
  if (!current()) return;
  await runtime.ensureOrdersData({ current, refresh: true });
}
async function settingsDependency(current) {
  const runtime = await import("./orders-runtime.js");
  if (current()) await runtime.ensureOrderSettings();
}

const lifecycle = createSectionLifecycle({
  all: async () => {
    const runtime = await import("./orders-runtime.js");
    return { load: async (_, current) => {
      const orders = await runtime.ensureOrdersUI();
      if (!current()) return;
      orders.paintOrdersFromLocalStorageIfAny();
      const links = await import("./order-task-links.js");
      if (!current()) return;
      void links.refreshActiveTaskOrderRefs();
      await orders.loadOrders({ full: true, shouldContinue: current });
    } };
  },
  new: async () => {
    const runtime = await import("./orders-runtime.js");
    return { load: async (_, current) => {
      const orders = await runtime.ensureOrderFormReady();
      if (current() && state.viewingOrderId == null && state.editingOrderId == null) orders.resetFormMode();
    } };
  },
  calculations: async () => {
    const m = await import("./calculations.js");
    return { load: () => m.initCalculationsSection() };
  },
  "all-salaries": async () => {
    const m = await import("./all-salaries.js");
    return { init: m.initAllSalariesSection, load: m.loadAllSalaries };
  },
  excess: async () => {
    const m = await import("./excess.js?v=37");
    return { init: m.bindExcessSection, load: m.loadExcesses };
  },
  messages: async () => {
    const m = await import("./messages.js");
    return { load: (opts) => m.onMessagesSectionEnter({ restoreFromUrl: Boolean(opts.restoreMessagesChat) }), leave: m.stopMessagesPolling };
  },
  voice: async () => {
    const m = await import("./voice.js");
    return { prepare: settingsDependency, load: m.onVoiceSectionEnter, leave: m.onVoiceSectionLeave };
  },
  "tasks-all": async () => {
    const m = await import("./tasks.js");
    return { init: m.initOrderTasksSection, load: m.loadAllTasks };
  },
  "order-tasks": async () => {
    const m = await import("./tasks.js");
    return { init: m.initOrderTasksSection, load: async () => {
      await Promise.all([m.loadOrderTasks(), m.ensureOrderTaskExecutorsLoaded()]);
    } };
  },
  "changes-all": async () => {
    const m = await import("./all-changes.js");
    return { init: m.initAllChangesSection, load: m.loadAllChanges };
  },
  balance: async () => {
    const m = await import("./balance.js");
    return { prepare: settingsDependency, load: () => m.loadBalance({ recordView: true }) };
  },
  "manager-salary": async () => {
    const m = await import("./manager-salary.js");
    return { prepare: async (current) => {
      await settingsDependency(current);
      if (current()) await ordersDependency(current);
    }, load: m.loadManagerSalary };
  },
  "route-sheet": async () => {
    const m = await import("./route-sheet.js");
    return { prepare: async (current) => {
      const runtime = await import("./orders-runtime.js");
      if (!current()) return;
      await Promise.all([runtime.ensureOrdersUI(), runtime.ensureOrderSettings()]);
      if (current()) await ordersDependency(current);
    }, init: m.initRouteSheetSection, load: m.loadRouteSheet, leave: m.bumpRouteDeliveryMapGeneration };
  },
  debts: async () => {
    const m = await import("./debts.js");
    return { prepare: ordersDependency, init: m.initDebtsSection, load: m.loadDebts };
  },
  statistics: async () => {
    const m = await import("./statistics.js");
    return { init: m.initStatisticsSection, load: () => m.loadStatistics({ refreshDefaultRange: true }) };
  },
  "statistics-balance": async () => {
    const m = await import("./statistics-balance.js");
    return { init: m.initStatisticsBalanceSection, load: () => m.loadStatisticsBalance({ refreshDefaultRange: true }) };
  },
  settings: async () => {
    const [m, ui] = await Promise.all([import("./settings.js"), import("./settings-ui.js")]);
    return { init: ui.bindSettingsUI, load: async (_, current) => {
      await m.loadSettings();
      if (!current()) return;
      m.applySettingsAdminBlocksVisibility();
      const push = await import("./push-notifications.js");
      if (!current()) return;
      push.initPushNotificationsSection();
      if (isAdmin()) {
        const links = await import("./login-links.js");
        if (!current()) return;
        links.initLoginLinksSection();
        await links.loadLoginLinksSection();
      }
    } };
  },
  "speed-test": async () => {
    const m = await import("./speed-test.js");
    return { load: m.onSpeedTestSectionEnter };
  },
});

export const enterSection = lifecycle.enter;
export function leaveSection(id) {
  cancelSectionReads(id);
  lifecycle.leave(id);
}
