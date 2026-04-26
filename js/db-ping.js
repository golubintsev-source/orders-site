import { supabaseClient } from "./config.js";

const INTERVAL_MS = 5000;
const FAST_MS = 1000;
/** Нет ответа от БД дольше этого — красный индикатор. */
const PING_TIMEOUT_MS = 5000;

const TIMEOUT_SENTINEL = Symbol("dbPingTimeout");

const CLASSES = ["db-ping-indicator--pending", "db-ping-indicator--ok", "db-ping-indicator--slow", "db-ping-indicator--error"];

function pingTimeoutRace() {
  return new Promise((_, reject) => {
    window.setTimeout(() => reject(TIMEOUT_SENTINEL), PING_TIMEOUT_MS);
  });
}

let intervalId = null;
let inFlight = false;

function setIndicator(el, kind, title, ariaLabel) {
  if (!el) return;
  el.classList.remove(...CLASSES);
  el.classList.add(`db-ping-indicator--${kind}`);
  el.title = title;
  el.setAttribute("aria-label", ariaLabel);
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
      return;
    }
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
  } finally {
    inFlight = false;
  }
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
