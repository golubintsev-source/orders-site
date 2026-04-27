import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import { formatOrderIdTypeChip, formatTaskDateRu } from "./format.js";
import { isOrderHiddenForCurrentRole } from "./roles.js";
import { setDbUnavailableBannerVisible } from "./dbHealth.js";
import {
  readSnapshot,
  persistOrderHistorySnapshot,
  mergeOrderHistoryRows,
  raceWithTimeout,
  isOfflineDataMode,
  OFFLINE_SUPABASE_WAIT_MS,
} from "./offline-cache.js";

/** YYYY-MM-DD в локальной календарной дате. */
function ymdLocal(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function defaultAllChangesDateFromYmd() {
  const t = new Date();
  t.setDate(t.getDate() - 2);
  return ymdLocal(t);
}

function defaultAllChangesDateToYmd() {
  return ymdLocal(new Date());
}

/** ISO границы суток (локально), конец дня включительно. */
function localDayRangeIsoInclusive(fromYmd, toYmd) {
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  const [ty, tm, td] = toYmd.split("-").map(Number);
  const start = new Date(fy, fm - 1, fd, 0, 0, 0, 0);
  const end = new Date(ty, tm - 1, td, 23, 59, 59, 999);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function readAllChangesDateRangeFromInputs() {
  const fromEl = document.getElementById("allChangesDateFrom");
  const toEl = document.getElementById("allChangesDateTo");
  let fromYmd = (fromEl?.value || "").trim();
  let toYmd = (toEl?.value || "").trim();
  if (!fromYmd) fromYmd = defaultAllChangesDateFromYmd();
  if (!toYmd) toYmd = defaultAllChangesDateToYmd();
  if (fromYmd > toYmd) {
    const s = fromYmd;
    fromYmd = toYmd;
    toYmd = s;
    if (fromEl) fromEl.value = fromYmd;
    if (toEl) toEl.value = toYmd;
  }
  const { startIso, endIso } = localDayRangeIsoInclusive(fromYmd, toYmd);
  return { fromYmd, toYmd, startIso, endIso };
}

function rowInCreatedAtRange(row, startIso, endIso) {
  const t = new Date(row?.created_at || 0).getTime();
  if (Number.isNaN(t)) return false;
  const a = new Date(startIso).getTime();
  const b = new Date(endIso).getTime();
  return t >= a && t <= b;
}

function escapeHtml(s) {
  if (s == null) return "";
  const div = document.createElement("div");
  div.textContent = String(s);
  return div.innerHTML;
}

/** Фильтрация строк таблицы по подстроке (без учёта регистра), по всем видимым ячейкам. */
function applyAllChangesFilter() {
  const input = document.getElementById("allChangesSearchInput");
  const tbody = document.querySelector("#allChangesTable tbody");
  if (!tbody) return;
  const q = (input?.value ?? "").trim().toLowerCase();
  const rows = tbody.querySelectorAll("tr.all-changes-row");
  for (const tr of rows) {
    if (!q) {
      tr.hidden = false;
      continue;
    }
    const haystack = (tr.textContent ?? "").toLowerCase();
    tr.hidden = !haystack.includes(q);
  }
}

/** Первые 5 символов логина (без «…»). */
function formatLoginFive(raw) {
  if (raw == null || raw === "") return "—";
  const s = String(raw).trim();
  if (!s) return "—";
  return s.slice(0, 5);
}

function buildOrderTypeByIdMap() {
  const m = new Map();
  for (const o of state.allOrders || []) {
    m.set(Number(o.id), o.order_type ?? "");
  }
  return m;
}

/**
 * @param {string} startIso
 * @param {string} endIso
 * @param {unknown[]} baseRowsForMerge — строки из снимка или с сервера (ещё до merge с очередью офлайна)
 * @param {{ error: unknown | null }} opts
 * @returns {number} число отрисованных строк
 */
function paintAllChangesFromBaseRows(startIso, endIso, baseRowsForMerge, opts) {
  const tbody = document.querySelector("#allChangesTable tbody");
  const msg = document.getElementById("allChangesMessage");
  if (!tbody) return 0;
  const { error } = opts;

  const rows = mergeOrderHistoryRows(baseRowsForMerge).filter((r) => rowInCreatedAtRange(r, startIso, endIso));
  const orderTypeById = buildOrderTypeByIdMap();
  const lines = [];
  for (const row of rows) {
    const orderType = orderTypeById.get(Number(row.order_id)) ?? "";
    if (isOrderHiddenForCurrentRole({ order_type: orderType })) continue;

    const chip = formatOrderIdTypeChip(row.order_id, orderType);
    const oid = row.order_id != null ? String(row.order_id) : "";
    const offlineCls = row.__offlinePendingSync ? " tr-order-offline-pending" : "";
    lines.push(`
    <tr class="all-changes-row${offlineCls}" data-order-id="${escapeHtml(oid)}">
      <td>${escapeHtml(formatTaskDateRu(row.created_at))}</td>
      <td>${escapeHtml(formatLoginFive(row.user_email))}</td>
      <td>${escapeHtml(chip)}</td>
      <td class="all-changes-text-cell">${escapeHtml(row.comment || "")}</td>
    </tr>`);
  }
  tbody.innerHTML = lines.join("");

  if (lines.length === 0 && msg) {
    msg.textContent = error
      ? "Нет сохранённой копии изменений за выбранный период на этом устройстве."
      : "За выбранный период записей нет.";
  }

  applyAllChangesFilter();
  return lines.length;
}

export async function loadAllChanges() {
  const tbody = document.querySelector("#allChangesTable tbody");
  const msg = document.getElementById("allChangesMessage");
  if (!tbody) return;
  if (msg) {
    msg.textContent = "";
    msg.classList.remove("order-tasks-message--error");
  }

  const { startIso, endIso } = readAllChangesDateRangeFromInputs();

  const snapRows = readSnapshot()?.order_history || [];
  const snapFiltered = snapRows.filter((r) => rowInCreatedAtRange(r, startIso, endIso));

  const historyQuery = () =>
    supabaseClient
      .from("order_history")
      .select("created_at, user_email, comment, order_id")
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: false });

  /** Без ожидания fetch: «офлайн» по флагу браузера, уже работаем с кэшем заказов, или ложный onLine без сети — сначала снимок. */
  const skipNetwork =
    (typeof navigator !== "undefined" && navigator.onLine === false) || isOfflineDataMode();

  let data = null;
  let error = null;

  if (skipNetwork) {
    error = { message: "offline" };
  } else {
    if (snapFiltered.length > 0) {
      paintAllChangesFromBaseRows(startIso, endIso, snapFiltered, { error: null });
    }
    try {
      /** Снимок уже на экране — не ждём полные 5 с при «ложном» onLine. */
      const waitMs = snapFiltered.length > 0 ? 1800 : OFFLINE_SUPABASE_WAIT_MS;
      const res = await raceWithTimeout(historyQuery(), waitMs);
      data = res.data;
      error = res.error;
    } catch (e) {
      if (e?.code === "TIMEOUT") {
        data = null;
        error = { message: "timeout" };
      } else {
        data = null;
        error = e;
      }
    }
  }

  if (error) {
    console.error("Ошибка загрузки истории изменений:", error);
    setDbUnavailableBannerVisible(true, { cacheMode: true });
    if (msg) {
      msg.textContent = "Показаны сохранённые на устройстве изменения; новые записи без сети — внизу с жёлтой заливкой.";
      msg.classList.remove("order-tasks-message--error");
    }
  } else {
    setDbUnavailableBannerVisible(false);
  }

  const baseRows = error ? snapFiltered : data || [];
  if (!error && data) persistOrderHistorySnapshot(data);

  paintAllChangesFromBaseRows(startIso, endIso, baseRows, { error });
}

export function initAllChangesSection() {
  const fromEl = document.getElementById("allChangesDateFrom");
  const toEl = document.getElementById("allChangesDateTo");
  if (fromEl && !fromEl.value) fromEl.value = defaultAllChangesDateFromYmd();
  if (toEl && !toEl.value) toEl.value = defaultAllChangesDateToYmd();

  const btn = document.getElementById("allChangesSearchBtn");
  const input = document.getElementById("allChangesSearchInput");
  if (!btn || !input) return;
  btn.addEventListener("click", () => {
    void loadAllChanges();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyAllChangesFilter();
    }
  });
}
