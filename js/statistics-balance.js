import { supabaseClient } from "./config.js";
import { formatAmountWholeRubles, formatTaskDateRu, toWholeRublesNumber } from "./format.js";
import { isAdmin } from "./roles.js";
import { displayNameByEmail } from "./user-names.js";
import { fetchAllSupabaseRows } from "./supabase-fetch.js";
import { BALANCE_SNAPSHOT_PATH } from "./app-routes.js";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toDatetimeLocalValue(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function defaultDatetimeFrom() {
  const d = new Date();
  d.setDate(d.getDate() - 2);
  d.setHours(0, 0, 0, 0);
  return toDatetimeLocalValue(d);
}

function defaultDatetimeTo() {
  return toDatetimeLocalValue(new Date());
}

export function refreshStatisticsBalanceDefaultRange() {
  const fromEl = document.getElementById("statisticsBalanceDatetimeFrom");
  const toEl = document.getElementById("statisticsBalanceDatetimeTo");
  if (fromEl) fromEl.value = defaultDatetimeFrom();
  if (toEl) toEl.value = defaultDatetimeTo();
}

/** Начало минуты для datetime-local (поле без секунд). */
function datetimeLocalToIsoStart(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setSeconds(0, 0);
  return d.toISOString();
}

/**
 * Конец минуты для верхней границы периода.
 * Иначе «по» = 12:24 превращается в 12:24:00.000 и свежие просмотры
 * в текущей минуте (12:24:01…12:24:59) не попадали в выборку.
 */
function datetimeLocalToIsoEnd(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setSeconds(59, 999);
  return d.toISOString();
}

function readRangeFromInputs() {
  const fromEl = document.getElementById("statisticsBalanceDatetimeFrom");
  const toEl = document.getElementById("statisticsBalanceDatetimeTo");
  let fromLocal = (fromEl?.value || "").trim();
  let toLocal = (toEl?.value || "").trim();
  if (!fromLocal) fromLocal = defaultDatetimeFrom();
  if (!toLocal) toLocal = defaultDatetimeTo();
  if (fromEl && !fromEl.value) fromEl.value = fromLocal;
  if (toEl && !toEl.value) toEl.value = toLocal;

  const fromMs = new Date(fromLocal).getTime();
  const toMs = new Date(toLocal).getTime();
  if (!Number.isNaN(fromMs) && !Number.isNaN(toMs) && fromMs > toMs) {
    const s = fromLocal;
    fromLocal = toLocal;
    toLocal = s;
    if (fromEl) fromEl.value = fromLocal;
    if (toEl) toEl.value = toLocal;
  }

  return {
    fromIso: datetimeLocalToIsoStart(fromLocal),
    toIso: datetimeLocalToIsoEnd(toLocal),
  };
}

function escapeHtml(s) {
  if (s == null) return "";
  const div = document.createElement("div");
  div.textContent = String(s);
  return div.innerHTML;
}

/** Разбор /balance-snapshot?d=&v=&k=&b= → суммы Дима/Вова/Касса/Безнал. */
export function parseBalanceSnapshotPath(pagePath) {
  try {
    const u = new URL(String(pagePath || ""), "https://local.invalid");
    if (u.pathname !== BALANCE_SNAPSHOT_PATH) return null;
    return {
      amount_dima: toWholeRublesNumber(u.searchParams.get("d")),
      amount_vova: toWholeRublesNumber(u.searchParams.get("v")),
      amount_kassa: toWholeRublesNumber(u.searchParams.get("k")),
      amount_beznal: toWholeRublesNumber(u.searchParams.get("b")),
    };
  } catch {
    return null;
  }
}

function viewerLabel(row) {
  const name = (row.user_name || "").trim();
  if (name) return name;
  return displayNameByEmail(row.user_email) || row.user_email || "—";
}

function applyFilter() {
  const input = document.getElementById("statisticsBalanceSearchInput");
  const tbody = document.querySelector("#statisticsBalanceTable tbody");
  if (!tbody) return;
  const q = (input?.value ?? "").trim().toLowerCase();
  const rows = tbody.querySelectorAll("tr.statistics-balance-row");
  for (const tr of rows) {
    if (!q) {
      tr.hidden = false;
      continue;
    }
    const haystack = (tr.textContent ?? "").toLowerCase();
    tr.hidden = !haystack.includes(q);
  }
}

function paintTable(rows) {
  const tbody = document.querySelector("#statisticsBalanceTable tbody");
  const msg = document.getElementById("statisticsBalanceMessage");
  if (!tbody) return;

  tbody.innerHTML = "";
  if (!rows.length) {
    if (msg) msg.textContent = "";
    return;
  }

  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.className = "statistics-balance-row";
    const viewer = viewerLabel(row);
    tr.innerHTML = `
      <td>${escapeHtml(formatTaskDateRu(row.created_at))}</td>
      <td title="${escapeHtml(row.user_email || "")}">${escapeHtml(viewer)}</td>
      <td class="td-money"><span class="status-value">${escapeHtml(formatAmountWholeRubles(row.amount_dima))}</span></td>
      <td class="td-money"><span class="status-value">${escapeHtml(formatAmountWholeRubles(row.amount_vova))}</span></td>
      <td class="td-money"><span class="status-value">${escapeHtml(formatAmountWholeRubles(row.amount_kassa))}</span></td>
      <td class="td-money"><span class="status-value">${escapeHtml(formatAmountWholeRubles(row.amount_beznal))}</span></td>
    `;
    tbody.appendChild(tr);
  }

  if (msg) msg.textContent = `Записей: ${rows.length}`;
  applyFilter();
}

function mapAccessLogToBalanceRow(logRow) {
  const amounts = parseBalanceSnapshotPath(logRow.page_path);
  if (!amounts) return null;
  const title = (logRow.page_title || "").trim();
  return {
    id: logRow.id,
    created_at: logRow.created_at,
    user_email: logRow.user_email,
    user_name: title || null,
    amount_dima: amounts.amount_dima,
    amount_vova: amounts.amount_vova,
    amount_kassa: amounts.amount_kassa,
    amount_beznal: amounts.amount_beznal,
  };
}

export async function loadStatisticsBalance(opts = {}) {
  if (!isAdmin()) return;

  const tbody = document.querySelector("#statisticsBalanceTable tbody");
  const msg = document.getElementById("statisticsBalanceMessage");
  if (!tbody) return;

  if (opts.refreshDefaultRange) {
    refreshStatisticsBalanceDefaultRange();
  }

  const { fromIso, toIso } = readRangeFromInputs();
  if (!fromIso || !toIso) {
    if (msg) msg.textContent = "Укажите корректный период.";
    return;
  }

  tbody.innerHTML = `<tr><td colspan="6" class="statistics-loading-cell">Загрузка…</td></tr>`;
  if (msg) msg.textContent = "";

  const { data, error } = await fetchAllSupabaseRows(() =>
    supabaseClient
      .from("site_access_logs")
      .select("id, created_at, user_email, page_path, page_title")
      .like("page_path", `${BALANCE_SNAPSHOT_PATH}%`)
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }),
  );

  if (error) {
    console.error("Ошибка загрузки статистики баланса:", error);
    tbody.innerHTML = "";
    const hint = error?.message ? ` ${error.message}` : "";
    if (msg) {
      msg.textContent = `Не удалось загрузить данные.${hint} Проверьте, что выполнен SQL из supabase_site_access_logs.sql (таблица, GRANT, RLS).`;
    }
    return;
  }

  const rows = (data || []).map(mapAccessLogToBalanceRow).filter(Boolean);
  paintTable(rows);
  if (!rows.length && msg) {
    msg.textContent =
      "За выбранный период записей нет. Каждое открытие раздела «Баланс» сохраняет строку «Сейчас» — обновите период или откройте «Баланс» и нажмите «Показать».";
  }
}

export function initStatisticsBalanceSection() {
  if (!isAdmin()) return;

  const fromEl = document.getElementById("statisticsBalanceDatetimeFrom");
  const toEl = document.getElementById("statisticsBalanceDatetimeTo");
  if (fromEl && !fromEl.value) fromEl.value = defaultDatetimeFrom();
  if (toEl && !toEl.value) toEl.value = defaultDatetimeTo();

  const btn = document.getElementById("statisticsBalanceLoadBtn");
  const searchInput = document.getElementById("statisticsBalanceSearchInput");
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      void loadStatisticsBalance();
    });
  }
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = "1";
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        applyFilter();
      }
    });
  }
}
