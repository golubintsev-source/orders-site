import assert from "node:assert/strict";
import { addCalendarMonths, buildDebtsMatrix, orderMatchesOrderTypeKeys } from "../js/debts-matrix.js";

assert.equal(addCalendarMonths("2026-08-24", -1), "2026-07-24");
assert.equal(addCalendarMonths("2026-08-24", -3), "2026-05-24");
assert.equal(addCalendarMonths("2026-01-31", -1), "2025-12-31");
assert.equal(addCalendarMonths("2026-03-31", -1), "2026-02-28");

const now = new Date(2026, 7, 24);
const matrix = buildDebtsMatrix(
  [
    {
      payment_status: "Клиент согласен",
      remaining_amount: 1000,
      remaining_to: "",
      order_date: "2026-08-20",
    },
    {
      payment_status: "Производство",
      remaining_amount: 2000,
      remaining_to: "",
      order_date: "2026-06-01",
    },
    {
      payment_status: "Товар передан заказчику",
      remaining_amount: 3000,
      remaining_to: "",
      order_date: "2026-04-01",
    },
    {
      payment_status: "Монтаж выполнен",
      remaining_amount: 4000,
      remaining_to: "Касса",
      order_date: "2026-01-01",
    },
    {
      payment_status: "Заказ закрыт",
      remaining_amount: 5000,
      remaining_to: "",
      order_date: "2026-01-01",
    },
  ],
  now,
);

assert.equal(matrix.byStatus["Клиент согласен"].all, 1000);
assert.equal(matrix.byStatus["Клиент согласен"].over1m, 0);
assert.equal(matrix.byStatus["Производство"].all, 2000);
assert.equal(matrix.byStatus["Производство"].over1m, 2000);
assert.equal(matrix.byStatus["Производство"].over3m, 0);
assert.equal(matrix.byStatus["Товар передан заказчику"].all, 3000);
assert.equal(matrix.byStatus["Товар передан заказчику"].over3m, 3000);
assert.equal(matrix.byStatus["Монтаж выполнен"].all, 0);
assert.equal(matrix.total.all, 6000);
assert.equal(matrix.total.over1m, 5000);
assert.equal(matrix.total.over3m, 3000);

assert.equal(orderMatchesOrderTypeKeys({ order_type: "Окна" }, []), true);
assert.equal(orderMatchesOrderTypeKeys({ order_type: "Окна" }, ["Окна"]), true);
assert.equal(orderMatchesOrderTypeKeys({ order_type: "Окна" }, ["Магазин"]), false);
assert.equal(orderMatchesOrderTypeKeys({ order_type: "" }, ["__empty__"]), true);
assert.equal(orderMatchesOrderTypeKeys({ order_type: "Подоконники" }, ["Окна", "Подоконники"]), true);

const windowsOnly = buildDebtsMatrix(
  [
    {
      payment_status: "Клиент согласен",
      remaining_amount: 1000,
      remaining_to: "",
      order_date: "2026-08-20",
      order_type: "Окна",
    },
    {
      payment_status: "Клиент согласен",
      remaining_amount: 500,
      remaining_to: "",
      order_date: "2026-08-20",
      order_type: "Магазин",
    },
  ].filter((o) => orderMatchesOrderTypeKeys(o, ["Окна"])),
  now,
);
assert.equal(windowsOnly.byStatus["Клиент согласен"].all, 1000);
assert.equal(windowsOnly.total.all, 1000);

console.log("test-debts-matrix: ok");
