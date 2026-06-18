import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import { syncDbUnavailableBanner } from "./dbHealth.js";

const INTERVAL_MS = 5000;
const FAST_MS = 1000;
/** Нет ответа от БД дольше этого — красный индикатор. */
const PING_TIMEOUT_MS = 5000;
/** Сколько подряд неудачных пингов нужно, чтобы включить офлайн-режим (не реагировать на один медленный ответ). */
const FAILURES_BEFORE_OFFLINE = 2;

const TIMEOUT_SENTINEL = Symbol("dbPingTimeout");

const CLASSES = ["db-ping-indicator--pending", "db-ping-indicator--ok", "db-ping-indicator--slow", "db-ping-indicator--error"];

function pingTimeoutRace() {
  return new Promise((_, reject) => {
    window.setTimeout(() => reject(TIMEOUT_SENTINEL), PING_TIMEOUT_MS);
  });
}

let intervalId = null;
let inFlight = false;
/** Предыдущий пинг завершился ошибкой/таймаутом — при следующем успехе перезагрузить заказы (синхронизация офлайн-очереди). */
let lastPingWasFailure = false;
let consecutivePingFailures = 0;

/** Красный индикатор пинга (с первой неудачи). Для журнала обращений — раньше, чем state.dbUnavailable. */
export function isDbPingIndicatingOffline() {
  return consecutivePingFailures >= 1;
}

function setIndicator(el, kind, title, ariaLabel) {
  if (!el) return;
  el.classList.remove(...CLASSES);
  el.classList.add(`db-ping-indicator--${kind}`);
  el.title = title;
  el.setAttribute("aria-label", ariaLabel);
}

function onDbPingFailure() {
  lastPingWasFailure = true;
  consecutivePingFailures += 1;
  if (consecutivePingFailures < FAILURES_BEFORE_OFFLINE) return;
  void import("./orders.js").then((m) => {
    if (typeof m.applyOfflineModeFromDbUnavailable === "function") {
      m.applyOfflineModeFromDbUnavailable();
    }
  });
}

function onDbPingSuccess() {
  consecutivePingFailures = 0;
  state.dbUnavailable = false;
  syncDbUnavailableBanner();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("db-ping-ok"));
  }
  if (lastPingWasFailure) {
    lastPingWasFailure = false;
    void import("./orders.js").then((m) => m.loadOrders());
  }
}

async function pingOnce() {
  const el = document.getElementById("dbPingIndicator");
  if (!el || inFlight) return;
  inFlight = true;
  const t0 = performance.now();
  try {
    const { error } = await Promise.race([
      supabaseClient.from("orders").select("id").limit(1),
      pingTimeoutRace(),
    ]);
    const ms = Math.round(performance.now() - t0);
    if (error) {
      setIndicator(
        el,
        "error",
        `База данных: нет связи (${error.message})`,
        `База данных: нет связи, ${error.message}`,
      );
      onDbPingFailure();
      return;
    }
    onDbPingSuccess();
    if (ms < FAST_MS) {
      setIndicator(el, "ok", `База данных: отлично (${ms} мс)`, `База данных: связь хорошая, ${ms} миллисекунд`);
    } else {
      setIndicator(
        el,
        "slow",
        `База данных: медленно (${ms} мс)`,
        `База данных: медленный ответ, ${ms} миллисекунд`,
      );
    }
  } catch (e) {
    if (e === TIMEOUT_SENTINEL) {
      const sec = PING_TIMEOUT_MS / 1000;
      setIndicator(
        el,
        "error",
        `База данных: нет ответа более ${sec} с`,
        `База данных: нет ответа более ${sec} секунд`,
      );
    } else {
      setIndicator(el, "error", "База данных: нет связи", "База данных: нет связи");
    }
    onDbPingFailure();
  } finally {
    inFlight = false;
  }
}

/** Внеочередная проверка (например после window «online»). */
export function triggerDbPingNow() {
  return pingOnce();
}

/** Периодический SELECT к Supabase (каждые 5 с): зелёный менее 1 с, жёлтый от 1 с, красный при ошибке или отсутствии ответа 5 с. */
export function initDbPingIndicator() {
  const el = document.getElementById("dbPingIndicator");
  if (!el) return;
  if (intervalId != null) {
    window.clearInterval(intervalId);
    intervalId = null;
  }
  setIndicator(el, "pending", "База данных: проверка…", "База данных: проверка соединения");
  pingOnce();
  intervalId = window.setInterval(pingOnce, INTERVAL_MS);
}
