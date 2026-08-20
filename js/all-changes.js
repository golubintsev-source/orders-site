import { supabaseClient, isOfflineWorkModeEnabled } from "./config.js";
import { state } from "./state.js";
import { formatOrderIdTypeChip, formatTaskDateRu, formatAmount } from "./format.js";
import { isOrderHiddenForCurrentRole } from "./roles.js";
import {
  readSnapshot,
  persistOrderHistorySnapshot,
  persistExcessHistorySnapshot,
  persistSettingsHistorySnapshot,
  persistCalculationHistorySnapshot,
  persistTaskHistorySnapshot,
  mergeOrderHistoryRows,
  raceWithTimeout,
  isOfflineDataMode,
  OFFLINE_SUPABASE_WAIT_MS,
  expandOrderHistoryCommentLines,
} from "./offline-cache.js";
import { fetchAllSupabaseRows } from "./supabase-fetch.js";

/** YYYY-MM-DD в локальной календарной дате. */
function ymdLocal(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function defaultAllChangesDateFromYmd() {
  return ymdLocal(new Date());
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

function sortAllChangesDisplayRows(rows) {
  return [...rows].sort((a, b) => {
    const ap = a.__offlinePendingSync ? 1 : 0;
    const bp = b.__offlinePendingSync ? 1 : 0;
    if (ap !== bp) return bp - ap;
    const ta = new Date(a.created_at || 0).getTime();
    const tb = new Date(b.created_at || 0).getTime();
    if (tb !== ta) return tb - ta;
    return String(b.id ?? "").localeCompare(String(a.id ?? ""), "en");
  });
}

/**
 * @param {string} startIso
 * @param {string} endIso
 * @param {unknown[]} orderHistoryBaseRows
 * @param {unknown[]} excessHistoryRows
 * @param {unknown[]} excessesRows — сами записи излишков (fallback / дополнение)
 * @param {unknown[]} settingsHistoryRows
 * @param {unknown[]} calculationHistoryRows
 * @param {unknown[]} taskHistoryRows
 * @param {{ error: unknown | null }} opts
 * @returns {number} число отрисованных строк
 */
function paintAllChangesFromBaseRows(
  startIso,
  endIso,
  orderHistoryBaseRows,
  excessHistoryRows,
  excessesRows,
  settingsHistoryRows,
  calculationHistoryRows,
  taskHistoryRows,
  opts,
) {
  const tbody = document.querySelector("#allChangesTable tbody");
  const msg = document.getElementById("allChangesMessage");
  if (!tbody) return 0;
  const { error } = opts;

  const orderTypeById = buildOrderTypeByIdMap();
  const displayRows = [];

  const orderRows = mergeOrderHistoryRows(orderHistoryBaseRows).filter((r) =>
    rowInCreatedAtRange(r, startIso, endIso),
  );
  for (const row of orderRows) {
    const orderType = orderTypeById.get(Number(row.order_id)) ?? "";
    if (isOrderHiddenForCurrentRole({ order_type: orderType })) continue;
    const chip = formatOrderIdTypeChip(row.order_id, orderType);
    const oid = row.order_id != null ? String(row.order_id) : "";
    for (const comment of expandOrderHistoryCommentLines(row.comment)) {
      displayRows.push({
        created_at: row.created_at,
        user_email: row.user_email,
        chip,
        order_id: oid,
        comment,
        __offlinePendingSync: Boolean(row.__offlinePendingSync),
        id: row.id,
      });
    }
  }

  const excessHistRows = (excessHistoryRows || []).filter((r) =>
    rowInCreatedAtRange(r, startIso, endIso),
  );
  const historyExcessIds = new Set();
  for (const row of excessHistRows) {
    if (row.excess_id != null) historyExcessIds.add(Number(row.excess_id));
    for (const comment of expandOrderHistoryCommentLines(row.comment)) {
      displayRows.push({
        created_at: row.created_at,
        user_email: row.user_email,
        chip: "Излишек",
        order_id: "",
        comment,
        __offlinePendingSync: false,
        id: row.id != null ? `exh-${row.id}` : undefined,
      });
    }
  }

  // Если детальная история по излишку ещё не записалась — показываем саму запись излишков.
  for (const row of excessesRows || []) {
    if (!rowInCreatedAtRange(row, startIso, endIso)) continue;
    if (row.id != null && historyExcessIds.has(Number(row.id))) continue;
    const client = String(row.client || "").trim() || "—";
    const amount =
      row.amount != null && row.amount !== "" ? `${formatAmount(row.amount)}\u00A0₽` : "—";
    const paidTo = String(row.paid_to || "").trim() || "—";
    displayRows.push({
      created_at: row.created_at,
      user_email: row.created_by,
      chip: "Излишек",
      order_id: "",
      comment: `Излишек: ${client}; сумма ${amount}; кому ${paidTo}`,
      __offlinePendingSync: false,
      id: row.id != null ? `ex-${row.id}` : undefined,
    });
  }

  const settingsHistRows = (settingsHistoryRows || []).filter((r) =>
    rowInCreatedAtRange(r, startIso, endIso),
  );
  for (const row of settingsHistRows) {
    for (const comment of expandOrderHistoryCommentLines(row.comment)) {
      displayRows.push({
        created_at: row.created_at,
        user_email: row.user_email,
        chip: "Корректировки",
        order_id: "",
        comment,
        __offlinePendingSync: false,
        id: row.id != null ? `sh-${row.id}` : undefined,
      });
    }
  }

  const calcHistRows = (calculationHistoryRows || []).filter((r) =>
    rowInCreatedAtRange(r, startIso, endIso),
  );
  for (const row of calcHistRows) {
    for (const comment of expandOrderHistoryCommentLines(row.comment)) {
      displayRows.push({
        created_at: row.created_at,
        user_email: row.user_email,
        chip: "Расчёт",
        order_id: "",
        comment,
        __offlinePendingSync: false,
        id: row.id != null ? `cah-${row.id}` : undefined,
      });
    }
  }

  const taskHistRows = (taskHistoryRows || []).filter((r) =>
    rowInCreatedAtRange(r, startIso, endIso),
  );
  for (const row of taskHistRows) {
    for (const comment of expandOrderHistoryCommentLines(row.comment)) {
      displayRows.push({
        created_at: row.created_at,
        user_email: row.user_email,
        chip: "Задача",
        order_id: "",
        comment,
        __offlinePendingSync: false,
        id: row.id != null ? `th-${row.id}` : undefined,
      });
    }
  }

  const sorted = sortAllChangesDisplayRows(displayRows);
  const lines = [];
  for (const row of sorted) {
    const offlineCls = row.__offlinePendingSync ? " tr-order-offline-pending" : "";
    lines.push(`
    <tr class="all-changes-row${offlineCls}" data-order-id="${escapeHtml(row.order_id || "")}">
      <td>${escapeHtml(formatTaskDateRu(row.created_at))}</td>
      <td>${escapeHtml(formatLoginFive(row.user_email))}</td>
      <td>${escapeHtml(row.chip || "—")}</td>
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

async function fetchExcessHistoryRows(startIso, endIso) {
  const { data, error } = await fetchAllSupabaseRows(() =>
    supabaseClient
      .from("excess_history")
      .select("id, created_at, user_email, comment, excess_id")
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }),
  );
  if (error) {
    console.warn("История излишков недоступна:", error.message || error);
    return { data: [], error };
  }
  return { data: data || [], error: null };
}

async function fetchExcessesRows(startIso, endIso) {
  const { data, error } = await fetchAllSupabaseRows(() =>
    supabaseClient
      .from("excesses")
      .select("id, created_at, client, amount, paid_to, created_by")
      .is("deleted_at", null)
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }),
  );
  if (error) {
    console.warn("Излишки для «Все изменения» недоступны:", error.message || error);
    return { data: [], error };
  }
  return { data: data || [], error: null };
}

async function fetchSettingsHistoryRows(startIso, endIso) {
  const { data, error } = await fetchAllSupabaseRows(() =>
    supabaseClient
      .from("settings_history")
      .select("id, created_at, user_email, comment, setting_key")
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }),
  );
  if (error) {
    console.warn("История корректировок недоступна:", error.message || error);
    return { data: [], error };
  }
  return { data: data || [], error: null };
}

async function fetchCalculationHistoryRows(startIso, endIso) {
  const { data, error } = await fetchAllSupabaseRows(() =>
    supabaseClient
      .from("calculation_history")
      .select("id, created_at, user_email, comment, calculation_id")
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }),
  );
  if (error) {
    console.warn("История расчётов недоступна:", error.message || error);
    return { data: [], error };
  }
  return { data: data || [], error: null };
}

async function fetchTaskHistoryRows(startIso, endIso) {
  const { data, error } = await fetchAllSupabaseRows(() =>
    supabaseClient
      .from("task_history")
      .select("id, created_at, user_email, comment, task_id")
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }),
  );
  if (error) {
    console.warn("История задач недоступна:", error.message || error);
    return { data: [], error };
  }
  return { data: data || [], error: null };
}

function excessHistoryQuery(startIso, endIso) {
  return () =>
    supabaseClient
      .from("excess_history")
      .select("id, created_at, user_email, comment, excess_id")
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
}

function excessesQuery(startIso, endIso) {
  return () =>
    supabaseClient
      .from("excesses")
      .select("id, created_at, client, amount, paid_to, created_by")
      .is("deleted_at", null)
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
}

function settingsHistoryQuery(startIso, endIso) {
  return () =>
    supabaseClient
      .from("settings_history")
      .select("id, created_at, user_email, comment, setting_key")
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
}

function calculationHistoryQuery(startIso, endIso) {
  return () =>
    supabaseClient
      .from("calculation_history")
      .select("id, created_at, user_email, comment, calculation_id")
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
}

function taskHistoryQuery(startIso, endIso) {
  return () =>
    supabaseClient
      .from("task_history")
      .select("id, created_at, user_email, comment, task_id")
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
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

  if (!isOfflineWorkModeEnabled()) {
    const [histRes, excessHistRes, excessesRes, settingsHistRes, calcHistRes, taskHistRes] =
      await Promise.all([
        fetchAllSupabaseRows(() =>
          supabaseClient
            .from("order_history")
            .select("created_at, user_email, comment, order_id")
            .gte("created_at", startIso)
            .lte("created_at", endIso)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false }),
        ),
        fetchExcessHistoryRows(startIso, endIso),
        fetchExcessesRows(startIso, endIso),
        fetchSettingsHistoryRows(startIso, endIso),
        fetchCalculationHistoryRows(startIso, endIso),
        fetchTaskHistoryRows(startIso, endIso),
      ]);

    if (histRes.error) {
      console.error("Ошибка загрузки истории изменений:", histRes.error);
      if (msg) {
        msg.textContent = "Ошибка загрузки истории изменений.";
        msg.classList.add("order-tasks-message--error");
      }
      paintAllChangesFromBaseRows(startIso, endIso, [], [], [], [], [], [], { error: histRes.error });
      return;
    }

    paintAllChangesFromBaseRows(
      startIso,
      endIso,
      histRes.data || [],
      excessHistRes.data || [],
      excessesRes.data || [],
      settingsHistRes.data || [],
      calcHistRes.data || [],
      taskHistRes.data || [],
      { error: null },
    );
    return;
  }

  const snapRows = readSnapshot()?.order_history || [];
  const snapFiltered = snapRows.filter((r) => rowInCreatedAtRange(r, startIso, endIso));
  const snapExcessHist = (readSnapshot()?.excess_history || []).filter((r) =>
    rowInCreatedAtRange(r, startIso, endIso),
  );
  const snapExcesses = (readSnapshot()?.excesses || []).filter(
    (r) => !r.deleted_at && rowInCreatedAtRange(r, startIso, endIso),
  );
  const snapSettingsHist = (readSnapshot()?.settings_history || []).filter((r) =>
    rowInCreatedAtRange(r, startIso, endIso),
  );
  const snapCalcHist = (readSnapshot()?.calculation_history || []).filter((r) =>
    rowInCreatedAtRange(r, startIso, endIso),
  );
  const snapTaskHist = (readSnapshot()?.task_history || []).filter((r) =>
    rowInCreatedAtRange(r, startIso, endIso),
  );

  const historyQuery = () =>
    supabaseClient
      .from("order_history")
      .select("created_at, user_email, comment, order_id")
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

  const skipNetwork =
    (typeof navigator !== "undefined" && navigator.onLine === false) || isOfflineDataMode();

  let data = null;
  let error = null;
  let excessHistData = snapExcessHist;
  let excessesData = snapExcesses;
  let settingsHistData = snapSettingsHist;
  let calcHistData = snapCalcHist;
  let taskHistData = snapTaskHist;

  const hasSnap =
    snapFiltered.length > 0 ||
    snapExcessHist.length > 0 ||
    snapExcesses.length > 0 ||
    snapSettingsHist.length > 0 ||
    snapCalcHist.length > 0 ||
    snapTaskHist.length > 0;

  if (skipNetwork) {
    error = { message: "offline" };
  } else {
    if (hasSnap) {
      paintAllChangesFromBaseRows(
        startIso,
        endIso,
        snapFiltered,
        snapExcessHist,
        snapExcesses,
        snapSettingsHist,
        snapCalcHist,
        snapTaskHist,
        { error: null },
      );
    }
    try {
      const waitMs = hasSnap ? 1800 : OFFLINE_SUPABASE_WAIT_MS;
      const [histRes, excessHistRes, excessesRes, settingsHistRes, calcHistRes, taskHistRes] =
        await raceWithTimeout(
          Promise.all([
            fetchAllSupabaseRows(historyQuery),
            fetchAllSupabaseRows(excessHistoryQuery(startIso, endIso)),
            fetchAllSupabaseRows(excessesQuery(startIso, endIso)),
            fetchAllSupabaseRows(settingsHistoryQuery(startIso, endIso)),
            fetchAllSupabaseRows(calculationHistoryQuery(startIso, endIso)),
            fetchAllSupabaseRows(taskHistoryQuery(startIso, endIso)),
          ]),
          waitMs,
        );
      data = histRes.data;
      error = histRes.error;
      if (!excessHistRes.error) excessHistData = excessHistRes.data || [];
      if (!excessesRes.error) excessesData = excessesRes.data || [];
      if (!settingsHistRes.error) settingsHistData = settingsHistRes.data || [];
      if (!calcHistRes.error) calcHistData = calcHistRes.data || [];
      if (!taskHistRes.error) taskHistData = taskHistRes.data || [];
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
    if (msg) {
      msg.textContent =
        "Показаны сохранённые на устройстве изменения; новые записи без сети — внизу с жёлтой заливкой.";
      msg.classList.remove("order-tasks-message--error");
    }
  }

  const baseRows = error ? snapFiltered : data || [];
  if (!error && data) persistOrderHistorySnapshot(data);
  if (!error && Array.isArray(excessHistData)) persistExcessHistorySnapshot(excessHistData);
  if (!error && Array.isArray(settingsHistData)) persistSettingsHistorySnapshot(settingsHistData);
  if (!error && Array.isArray(calcHistData)) persistCalculationHistorySnapshot(calcHistData);
  if (!error && Array.isArray(taskHistData)) persistTaskHistorySnapshot(taskHistData);

  paintAllChangesFromBaseRows(
    startIso,
    endIso,
    baseRows,
    error ? snapExcessHist : excessHistData || [],
    error ? snapExcesses : excessesData || [],
    error ? snapSettingsHist : settingsHistData || [],
    error ? snapCalcHist : calcHistData || [],
    error ? snapTaskHist : taskHistData || [],
    { error },
  );
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
