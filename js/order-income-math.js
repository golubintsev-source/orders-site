/** Сумма фактически полученных денег до нового поступления. */
export function recordedOrderIncome(order, netLedgerIncome = 0) {
  const prepayment = Number(order?.prepayment || 0);
  const lastPayment = order?.remaining_to ? Number(order?.remaining_amount || 0) : 0;
  return Math.max(0, Number(netLedgerIncome || 0), prepayment + lastPayment);
}

/** «Остаток» после полного расчёта несколькими платежами — последний платёж. */
export function calculateOrderIncomeFields(cost, paidBefore, payment, hadPayments) {
  if (![cost, paidBefore, payment].every(Number.isSafeInteger) || cost <= 0 || paidBefore < 0 || payment <= 0) {
    throw new Error("Укажите положительную стоимость и сумму в целых рублях");
  }
  const total = paidBefore + payment;
  if (!Number.isSafeInteger(total) || total > cost) throw new Error("Доходы по заказу не могут превышать стоимость");
  if (total < cost) return { prepayment: total, remaining_amount: cost - total, paid: false };
  if (!hadPayments && paidBefore === 0) return { prepayment: 0, remaining_amount: payment, paid: true };
  return { prepayment: cost - payment, remaining_amount: payment, paid: true };
}
