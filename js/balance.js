import { supabaseClient } from "./config.js";
import { isUserLite } from "./roles.js";
import { checkDatabaseAvailable, setDbUnavailableBannerVisible } from "./dbHealth.js";
import { formatAmount } from "./format.js";
import { state } from "./state.js";

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

export async function loadBalance() {
  const messageEl = document.getElementById("balanceMessage");
  const tbody = document.querySelector("#balanceTable tbody");
  if (!tbody) return;

  if (messageEl) messageEl.textContent = "";

  if (!(await checkDatabaseAvailable())) {
    setDbUnavailableBannerVisible(true);
    if (messageEl) messageEl.textContent = "Не удалось загрузить баланс.";
    tbody.innerHTML = "";
    return;
  }

  const balances = Object.fromEntries(PARTICIPANTS.map((p) => [p, 0]));
  const [todayKey, dayM1Key, dayM2Key, dayM3Key] = getRecentMskDayKeys(4);
  const turnover = Object.fromEntries(
    PARTICIPANTS.map((p) => [
      p,
      { today: 0, m1: 0, m2: 0, m3: 0 },
    ])
  );

  const calcRes = await supabaseClient
    .from("calculations")
    .select("from_place,to_place,amount,created_at")
    .is("deleted_at", null);

  if (calcRes.error) {
    console.error("Ошибка загрузки расчётов для баланса:", calcRes.error);
    setDbUnavailableBannerVisible(true);
    if (messageEl) messageEl.textContent = "Ошибка загрузки расчётов для баланса";
    return;
  }
  setDbUnavailableBannerVisible(false);
  const calcRows = calcRes.data || [];
  for (const row of calcRows) {
    const amount = toNumber(row.amount);
    // Откуда => минус, Куда => плюс
    addDelta(balances, row.from_place, -amount);
    addDelta(balances, row.to_place, amount);

    // Сальдо по дням (МСК): те же знаки, что и в основном балансе.
    const dayKey = row.created_at ? mskDayKeyFromDate(new Date(row.created_at)) : "";
    const bucket =
      dayKey === todayKey ? "today"
        : dayKey === dayM1Key ? "m1"
          : dayKey === dayM2Key ? "m2"
            : dayKey === dayM3Key ? "m3"
              : null;
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

  tbody.innerHTML = PARTICIPANTS.map((p) => {
    return `
      <tr>
        <td>${escapeHtml(p)}</td>
        <td class="td-money">${formatAmount(balances[p])}</td>
        <td class="td-money">${formatAmount(turnover[p].today)}</td>
        <td class="td-money">${formatAmount(turnover[p].m1)}</td>
        <td class="td-money">${formatAmount(turnover[p].m2)}</td>
        <td class="td-money">${formatAmount(turnover[p].m3)}</td>
      </tr>
    `;
  }).join("");
}

export async function initBalanceSection() {
  if (isUserLite()) return;
  await loadBalance();
}

