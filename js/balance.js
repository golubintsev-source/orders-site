import { supabaseClient } from "./config.js";
import { isUserLite } from "./roles.js";
import { formatAmount } from "./format.js";
import { state } from "./state.js";

const PARTICIPANTS = ["Дима", "Вова", "Касса", "Безнал"];

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

export async function loadBalance() {
  const messageEl = document.getElementById("balanceMessage");
  const tbody = document.querySelector("#balanceTable tbody");
  if (!tbody) return;

  if (messageEl) messageEl.textContent = "";

  const balances = Object.fromEntries(PARTICIPANTS.map((p) => [p, 0]));

  const [calcRes, ordersRes] = await Promise.all([
    supabaseClient
      .from("calculations")
      .select("from_place,to_place,amount"),
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
      </tr>
    `;
  }).join("");
}

export async function initBalanceSection() {
  if (isUserLite()) return;
  await loadBalance();
}

