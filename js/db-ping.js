import { supabaseClient } from "./config.js";

const INTERVAL_MS = 5000;
const FAST_MS = 1000;

const CLASSES = ["db-ping-indicator--pending", "db-ping-indicator--ok", "db-ping-indicator--slow", "db-ping-indicator--error"];

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
    const { error } = await supabaseClient.from("orders").select("id").limit(1);
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
  } catch {
    setIndicator(el, "error", "База данных: нет связи", "База данных: нет связи");
  } finally {
    inFlight = false;
  }
}

/** Периодический SELECT к Supabase (каждые 5 с): зелёный менее 1 с, жёлтый от 1 с, красный при ошибке. */
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
