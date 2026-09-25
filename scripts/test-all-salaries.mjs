import assert from "node:assert/strict";
import {
  groupSalaryRowsByMonth,
  isSalaryCalculationRow,
} from "../js/all-salaries-utils.js";

const manualSalary = {
  id: 1,
  created_at: "2026-08-15T10:00:00.000Z",
  amount: 12000,
  comment: "Мария ЗП; Алексей",
  deleted_at: null,
};

assert.equal(isSalaryCalculationRow(manualSalary), true);
assert.equal(isSalaryCalculationRow({ ...manualSalary, comment: "аванс зп; Алексей" }), true);
assert.equal(isSalaryCalculationRow({ ...manualSalary, comment: "Аванс; Алексей" }), false);
assert.equal(
  isSalaryCalculationRow({ ...manualSalary, comment: "[AUTO_ORDER_DELTA] клиент ЗП" }),
  false,
);
assert.equal(isSalaryCalculationRow({ ...manualSalary, deleted_at: "2026-08-20T00:00:00Z" }), false);

const groups = groupSalaryRowsByMonth([
  manualSalary,
  { ...manualSalary, id: 2, created_at: "2026-08-20T10:00:00.000Z", amount: "8000" },
  { ...manualSalary, id: 3, created_at: "2026-09-01T10:00:00.000Z", amount: 15000 },
  { ...manualSalary, id: 4, comment: "Покупка материалов" },
]);

assert.deepEqual(
  groups.map((group) => ({ monthKey: group.monthKey, total: group.total, ids: group.rows.map((r) => r.id) })),
  [
    { monthKey: "2026-09", total: 15000, ids: [3] },
    { monthKey: "2026-08", total: 20000, ids: [2, 1] },
  ],
);

console.log("test-all-salaries: ok");
