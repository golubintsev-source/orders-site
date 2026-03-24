import { supabaseClient } from "./config.js";
import { isUserLite } from "./roles.js";
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
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: MSK_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date); // YYYY-MM-DD
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

  const balances = Object.fromEntries(PARTICIPANTS.map((p) => [p, 0]));
  const [todayKey, dayM1Key, dayM2Key, dayM3Key] = getRecentMskDayKeys(4);
  const turnover = Object.fromEntries(
    PARTICIPANTS.map((p) => [
      p,
      { today: 0, m1: 0, m2: 0, m3: 0 },
    ])
  );

  const [calcRes, ordersRes] = await Promise.all([
    supabaseClient
      .from("calculations")
      .select("from_place,to_place,amount,created_at"),
    supabaseClient
      .from("orders")
      .select("prepayment,prepayment_to,remaining_amount,remaining_to,installer_payment_amount,installer_payment_by,deleted_at")
      .is("deleted_at", null),
  ]);

  if (calcRes.error) {
    console.error("Ошибка загрузки расчётов для баланса:", calcRes.error);
    if (messageEl) messageEl.textContent = "Ошибка загрузки расчётов для баланса";
    return;
  }
  if (ordersRes.error) {
    console.error("Ошибка загрузки заказов для баланса:", ordersRes.error);
    if (messageEl) messageEl.textContent = "Ошибка загрузки заказов для баланса";
    return;
  }

  const calcRows = calcRes.data || [];
  for (const row of calcRows) {
    const amount = toNumber(row.amount);
    // Откуда => минус, Куда => плюс
    addDelta(balances, row.from_place, -amount);
    addDelta(balances, row.to_place, amount);

    // Оборот по дням (МСК): учитываем абсолютную сумму операции для каждого участника стороны перевода.
    const dayKey = row.created_at ? mskDayKeyFromDate(new Date(row.created_at)) : "";
    const bucket =
      dayKey === todayKey ? "today"
        : dayKey === dayM1Key ? "m1"
          : dayKey === dayM2Key ? "m2"
            : dayKey === dayM3Key ? "m3"
              : null;
    if (!bucket) continue;
    const absAmount = Math.abs(amount);
    if (row.from_place && Object.prototype.hasOwnProperty.call(turnover, row.from_place)) {
      turnover[row.from_place][bucket] += absAmount;
    }
    if (row.to_place && Object.prototype.hasOwnProperty.call(turnover, row.to_place)) {
      turnover[row.to_place][bucket] += absAmount;
    }
  }

  const orders = ordersRes.data || [];
  for (const o of orders) {
    // Предоплата => плюс
    addDelta(balances, o.prepayment_to, toNumber(o.prepayment));
    // Остаток => плюс
    addDelta(balances, o.remaining_to, toNumber(o.remaining_amount));
    // Оплатил монтаж => минус (сумма за монтаж)
    addDelta(balances, o.installer_payment_by, -toNumber(o.installer_payment_amount));
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

