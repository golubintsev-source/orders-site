import { supabaseClient } from "./config.js";
import { isUserLite, isUserShop } from "./roles.js";
import { formatAmountWholeRubles } from "./format.js";
import { state } from "./state.js";
import { persistBalanceOfflineView, readBalanceOfflineView, isOfflineDataMode } from "./offline-cache.js";
import { isOfflineWorkModeEnabled } from "./config.js";
import { fetchAllSupabaseRows } from "./supabase-fetch.js";
import { displayNameByEmail } from "./user-names.js";

const PARTICIPANTS = ["Вова", "Дима", "Касса", "Безнал"];
const MSK_TZ = "Europe/Moscow";

function escapeHtml(s) {
  if (s == null) return "";
  const div = document.createElement("div");
  div.textContent = String(s);
  return div.innerHTML;
}

function addDelta(balances, participant, delta) {
  if (!participant) return;
  if (!Object.prototype.hasOwnProperty.call(balances, participant)) return;
  balances[participant] += delta;
}

function toNumber(val) {
  if (val == null || val === "") return 0;
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function mskDayKeyFromDate(date) {
  const fmt = new Intl.DateTimeFormat("ru-RU", {
    timeZone: MSK_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !d) return "";
  return `${y}-${m}-${d}`;
}

function getRecentMskDayKeys(daysCount) {
  const nowKey = mskDayKeyFromDate(new Date());
  const [y, m, d] = nowKey.split("-").map((x) => Number(x));
  const baseUtc = new Date(Date.UTC(y, m - 1, d));
  const keys = [];
  for (let i = 0; i < daysCount; i++) {
    const x = new Date(baseUtc);
    x.setUTCDate(x.getUTCDate() - i);
    const yyyy = x.getUTCFullYear();
    const mm = String(x.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(x.getUTCDate()).padStart(2, "0");
    keys.push(`${yyyy}-${mm}-${dd}`);
  }
  return keys;
}

/** Считает метрики по строкам расчётов (только при успешной загрузке из БД). */
function computeBalanceMetricsFromCalcRows(calcRows) {
  const balances = Object.fromEntries(PARTICIPANTS.map((p) => [p, 0]));
  const [todayKey, dayM1Key, dayM2Key, dayM3Key] = getRecentMskDayKeys(4);
  const turnover = Object.fromEntries(
    PARTICIPANTS.map((p) => [
      p,
      { hour: 0, today: 0, m1: 0, m2: 0, m3: 0 },
    ])
  );
  const hourAgoMs = Date.now() - 60 * 60 * 1000;
  for (const row of calcRows || []) {
    const amount = toNumber(row.amount);
    addDelta(balances, row.from_place, -amount);
    addDelta(balances, row.to_place, amount);

    const dayKey = row.created_at ? mskDayKeyFromDate(new Date(row.created_at)) : "";
    const bucket =
      dayKey === todayKey ? "today"
        : dayKey === dayM1Key ? "m1"
          : dayKey === dayM2Key ? "m2"
            : dayKey === dayM3Key ? "m3"
              : null;

    const rowTime = row.created_at ? new Date(row.created_at).getTime() : NaN;
    if (Number.isFinite(rowTime) && rowTime >= hourAgoMs) {
      if (row.from_place && Object.prototype.hasOwnProperty.call(turnover, row.from_place)) {
        turnover[row.from_place].hour -= amount;
      }
      if (row.to_place && Object.prototype.hasOwnProperty.call(turnover, row.to_place)) {
        turnover[row.to_place].hour += amount;
      }
    }

    if (!bucket) continue;
    if (row.from_place && Object.prototype.hasOwnProperty.call(turnover, row.from_place)) {
      turnover[row.from_place][bucket] -= amount;
    }
    if (row.to_place && Object.prototype.hasOwnProperty.call(turnover, row.to_place)) {
      turnover[row.to_place][bucket] += amount;
    }
  }

  for (const p of PARTICIPANTS) {
    const adj = state.balanceAdjustments[p];
    const n = adj == null || adj === "" ? 0 : Number(adj);
    balances[p] += Number.isFinite(n) ? Math.trunc(n) : 0;
  }

  return { balances, turnover };
}

function isBalanceOfflineDocRenderable(doc) {
  if (!doc?.balances || !doc?.turnover) return false;
  for (const p of PARTICIPANTS) {
    if (!Object.prototype.hasOwnProperty.call(doc.balances, p)) return false;
    const t = doc.turnover[p];
    if (!t || typeof t !== "object") return false;
    for (const k of ["hour", "today", "m1", "m2", "m3"]) {
      if (typeof t[k] !== "number" || !Number.isFinite(t[k])) return false;
    }
    if (typeof doc.balances[p] !== "number" || !Number.isFinite(doc.balances[p])) return false;
  }
  return true;
}

/** Рисует таблицу по уже готовым числам (из БД или из кеша). */
function paintBalanceTable(balances, turnover, messageEl) {
  const theadRow = document.querySelector("#balanceTable thead tr");
  const tbody = document.querySelector("#balanceTable tbody");
  if (!theadRow || !tbody) return;

  if (messageEl) messageEl.textContent = "";

  theadRow.innerHTML =
    '<th scope="col"></th>' +
    PARTICIPANTS.map((p) => `<th scope="col">${escapeHtml(p)}</th>`).join("");

  const metricRows = [
    { label: "Сейчас", value: (p) => balances[p] },
    { label: "Час", value: (p) => turnover[p].hour },
    { label: "Сегодня", value: (p) => turnover[p].today },
    { label: "С-1", value: (p) => turnover[p].m1 },
    { label: "С-2", value: (p) => turnover[p].m2 },
    { label: "С-3", value: (p) => turnover[p].m3 },
  ];

  tbody.innerHTML = metricRows
    .map(
      ({ label, value }) => `
      <tr>
        <th scope="row">${escapeHtml(label)}</th>
        ${PARTICIPANTS.map(
          (p) =>
            `<td class="td-money"><span class="status-value">${formatAmountWholeRubles(value(p))}</span></td>`
        ).join("")}
      </tr>
    `
    )
    .join("");
}

function tryPaintBalanceFromOfflineCache(messageEl, cacheHint) {
  const doc = readBalanceOfflineView();
  if (!doc || !isBalanceOfflineDocRenderable(doc)) return false;
  paintBalanceTable(doc.balances, doc.turnover, messageEl);
  if (messageEl) {
    const savedAt = doc.at ? new Date(doc.at).toLocaleString("ru-RU") : "";
    messageEl.textContent = savedAt
      ? `${cacheHint} Сохранено: ${savedAt}.`
      : cacheHint;
  }
  return true;
}

/**
 * Все неудалённые расчёты для баланса.
 * Без пагинации Supabase молча обрезает ответ (~1000 строк) — С-1/С-2/С-3 становятся нулями.
 */
async function fetchAllCalculationsForBalance() {
  return fetchAllSupabaseRows(() =>
    supabaseClient
      .from("calculations")
      .select("id,from_place,to_place,amount,created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  );
}

function toWholeRubles(val) {
  const n = Number(val);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/**
 * Сохраняет снимок строки «Сейчас» при открытии раздела «Баланс».
 * Ошибки не блокируют показ таблицы.
 */
async function recordBalanceViewSnapshot(balances) {
  const user = state.currentUser;
  if (!user?.id || !balances) return;

  const row = {
    user_id: user.id,
    user_email: user.email || null,
    user_name: displayNameByEmail(user.email) || null,
    amount_dima: toWholeRubles(balances["Дима"]),
    amount_vova: toWholeRubles(balances["Вова"]),
    amount_kassa: toWholeRubles(balances["Касса"]),
    amount_beznal: toWholeRubles(balances["Безнал"]),
  };

  try {
    const { error } = await supabaseClient.from("balance_view_logs").insert(row);
    if (error) {
      console.error("Не удалось записать просмотр баланса:", error);
    }
  } catch (e) {
    console.error("Не удалось записать просмотр баланса:", e);
  }
}

/**
 * @param {{ recordView?: boolean }} [opts] — recordView: сохранить снимок «Сейчас» (вход в раздел).
 */
export async function loadBalance(opts = {}) {
  const { recordView = false } = opts;
  const messageEl = document.getElementById("balanceMessage");
  const theadRow = document.querySelector("#balanceTable thead tr");
  const tbody = document.querySelector("#balanceTable tbody");
  if (!theadRow || !tbody) return;

  const offlineMsg = "Показаны сохранённые значения баланса (без сети).";

  if (isOfflineWorkModeEnabled() && isOfflineDataMode()) {
    if (tryPaintBalanceFromOfflineCache(messageEl, offlineMsg)) return;
    if (messageEl) {
      messageEl.textContent = "Нет сети и нет сохранённого баланса. Откройте раздел при подключении к интернету.";
    }
    return;
  }

  let calcRes;
  try {
    calcRes = await fetchAllCalculationsForBalance();
  } catch (e) {
    console.error("Ошибка загрузки расчётов для баланса:", e);
    if (messageEl) messageEl.textContent = "Ошибка загрузки расчётов для баланса.";
    return;
  }

  if (calcRes.error) {
    console.error("Ошибка загрузки расчётов для баланса:", calcRes.error);
    if (messageEl) messageEl.textContent = "Ошибка загрузки расчётов для баланса.";
    return;
  }

  const calcRows = calcRes.data || [];
  const metrics = computeBalanceMetricsFromCalcRows(calcRows);
  paintBalanceTable(metrics.balances, metrics.turnover, messageEl);
  persistBalanceOfflineView(metrics);

  if (recordView) {
    void recordBalanceViewSnapshot(metrics.balances);
  }
}

export async function initBalanceSection() {
  if (isUserLite() || isUserShop()) return;
  await loadBalance({ recordView: true });
}
