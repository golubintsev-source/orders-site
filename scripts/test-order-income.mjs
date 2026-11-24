import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateOrderIncomeFields, recordedOrderIncome } from '../js/order-income-math.js';

assert.deepEqual(calculateOrderIncomeFields(100, 0, 30, false), { prepayment: 30, remaining_amount: 70, paid: false });
assert.deepEqual(calculateOrderIncomeFields(100, 30, 20, true), { prepayment: 50, remaining_amount: 50, paid: false });
assert.deepEqual(calculateOrderIncomeFields(100, 0, 100, false), { prepayment: 0, remaining_amount: 100, paid: true });
assert.deepEqual(calculateOrderIncomeFields(100, 30, 70, true), { prepayment: 30, remaining_amount: 70, paid: true });
assert.throws(() => calculateOrderIncomeFields(100, 80, 21, true), /превышать стоимость/);
assert.equal(recordedOrderIncome({ prepayment: 30, remaining_amount: 70, remaining_to: 'Дима' }, 20), 100);
assert.equal(recordedOrderIncome({ prepayment: 30, remaining_amount: 70, remaining_to: '' }, 20), 30);

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const orders = await readFile(new URL('../js/orders.js', import.meta.url), 'utf8');
const income = await readFile(new URL('../js/order-calculations.js', import.meta.url), 'utf8');
const incomeSql = await readFile(new URL('../sql/order_income_atomic_prepare.sql', import.meta.url), 'utf8');
assert.ok(html.indexOf('id="orderIncomeBlock"') < html.indexOf('id="orderCalculationsBlock"'));
assert.ok(html.indexOf('id="orderCalculationsBlock"') < html.indexOf('id="orderCalculationsList"'));
assert.match(html, /id="prepayment"[^>]*readonly/);
assert.match(html, /id="remaining_amount"[^>]*readonly/);
assert.match(income, /rpc\("add_order_income"/);
assert.match(orders, /showOrderCalculations\(data, \{ viewOnly: true \}\)/);
assert.doesNotMatch(orders.slice(orders.indexOf('function buildOrderDeltaCalculationInsertRows('), orders.indexOf('function buildOrderDeltaCalculationInsertRows(') + 4000), /pushAmountRecipientCalcRow\("Предоплата"|pushAmountRecipientCalcRow\("Остаток"/);
assert.match(incomeSql, /v_remaining := greatest\(v_order\.amount - v_total, 0\)/);
assert.match(incomeSql, /Остаток: '\s*\|\|\s*v_remaining::text/);
assert.match(incomeSql, /Тракторозаводский\|Краснооктябрьский[\s\S]*Красноармейский/);
console.log('order income: staged calculations, old baseline, layout and shared ledger passed');
