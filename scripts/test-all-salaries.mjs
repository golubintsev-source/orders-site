import assert from "node:assert/strict";
import {
  getSalaryEmployeeName,
  groupSalaryRowsByEmployee,
  groupSalaryRowsByMonth,
  isSalaryCalculationRow,
  salaryMonthKey,
  isInstallationSalaryRow,
  installationSalaryOrderId,
  salaryCalculationAmount,
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
assert.equal(isSalaryCalculationRow({ ...manualSalary, comment: "Аванс; Алексей" }), true);
assert.equal(isSalaryCalculationRow({ ...manualSalary, comment: "ЗАРПЛАТА Марии; Алексей" }), true);
assert.equal(isSalaryCalculationRow({ ...manualSalary, comment: "ПреМиЯ за август; Алексей" }), true);
assert.equal(isSalaryCalculationRow({ ...manualSalary, comment: "бонус Марии; Алексей" }), true);
assert.equal(isSalaryCalculationRow({ ...manualSalary, comment: "Покупка материалов" }), false);
assert.equal(
  isSalaryCalculationRow({ ...manualSalary, comment: "[AUTO_ORDER_DELTA] клиент ЗП" }),
  false,
);
assert.equal(
  isSalaryCalculationRow({ ...manualSalary, comment: "[AUTO_EXCESS_DELTA] премия" }),
  false,
);
assert.equal(isSalaryCalculationRow({ ...manualSalary, deleted_at: "2026-08-20T00:00:00Z" }), false);

assert.equal(getSalaryEmployeeName("зп Иван Сотников возврат долг 1980=459 503; Лена"), "Иван Сотников");
assert.equal(getSalaryEmployeeName("зп Леша; Лена"), "Леша");
assert.equal(getSalaryEmployeeName("Мария ЗП; Алексей"), "Мария");
assert.equal(getSalaryEmployeeName("Премия Марии за сентябрь; Алексей"), "Марии");
assert.equal(getSalaryEmployeeName("зп леша; Лена"), "Леша");
assert.equal(getSalaryEmployeeName("Премия за сентябрь; Алексей"), "");

assert.deepEqual(
  groupSalaryRowsByEmployee([
    { amount: 10000, comment: "зп Леша; Лена" },
    { amount: "5000", comment: "премия Леша; Алексей" },
    { amount: 7000, comment: "зп Иван Сотников; Лена" },
    { amount: 1000, comment: "аванс; Лена" },
  ]).map(({ employee, total, count }) => ({ employee, total, count })),
  [
    { employee: "Леша", total: 15000, count: 2 },
    { employee: "Иван Сотников", total: 7000, count: 1 },
    { employee: "Не указан", total: 1000, count: 1 },
  ],
);

const monthForms = [
  ["январь", "января", "январе"],
  ["февраль", "февраля", "феврале"],
  ["март", "марта", "марте"],
  ["апрель", "апреля", "апреле"],
  ["май", "мая", "мае"],
  ["июнь", "июня", "июне"],
  ["июль", "июля", "июле"],
  ["август", "августа", "августе"],
  ["сентябрь", "сентября", "сентябре"],
  ["октябрь", "октября", "октябре"],
  ["ноябрь", "ноября", "ноябре"],
  ["декабрь", "декабря", "декабре"],
];

for (const [monthIndex, forms] of monthForms.entries()) {
  for (const form of forms) {
    assert.equal(
      salaryMonthKey("2026-07-15T10:00:00.000Z", `ЗП за ${form} 2026`),
      `2026-${String(monthIndex + 1).padStart(2, "0")}`,
    );
  }
}

assert.equal(salaryMonthKey("2026-10-05T10:00:00.000Z", "ЗП за сентябрь"), "2026-09");
assert.equal(salaryMonthKey("2027-01-05T10:00:00.000Z", "Премия за декабрь"), "2026-12");
assert.equal(salaryMonthKey("2027-01-05T10:00:00.000Z", "ЗП за декабрь 2025"), "2025-12");
assert.equal(salaryMonthKey("2026-08-15T10:00:00.000Z", "Майя бонус"), "2026-08");

const groups = groupSalaryRowsByMonth([
  manualSalary,
  { ...manualSalary, id: 2, created_at: "2026-08-20T10:00:00.000Z", amount: "8000" },
  { ...manualSalary, id: 3, created_at: "2026-09-01T10:00:00.000Z", amount: 15000 },
  {
    ...manualSalary,
    id: 5,
    created_at: "2026-09-05T10:00:00.000Z",
    amount: 5000,
    comment: "премия за август; Алексей",
  },
  { ...manualSalary, id: 4, comment: "Покупка материалов" },
]);

assert.deepEqual(
  groups.map((group) => ({ monthKey: group.monthKey, total: group.total, ids: group.rows.map((r) => r.id) })),
  [
    { monthKey: "2026-09", total: 15000, ids: [3] },
    { monthKey: "2026-08", total: 25000, ids: [5, 2, 1] },
  ],
);

console.log("test-all-salaries: ok");


// New form uses «з/п» and a comma to separate the exact recipient from free text.
const formPayment = { id: 90, created_at: "2026-10-27T10:00:00Z", from_place: "Касса", to_place: "Иван Сотников", amount: 2500, comment: "з/п Иван Сотников, Доплата за сентябрь; Алексей" };
assert.equal(isSalaryCalculationRow(formPayment), true);
assert.equal(getSalaryEmployeeName(formPayment.comment), "Иван Сотников");
assert.equal(groupSalaryRowsByEmployee([formPayment])[0].employee, "Иван Сотников");
assert.equal(groupSalaryRowsByMonth([formPayment])[0].total, 2500);
assert.equal(groupSalaryRowsByMonth([formPayment])[0].monthKey, "2026-09");
assert.equal(isSalaryCalculationRow({ ...formPayment, deleted_at: "2026-10-27" }), false);

const salaryDestinationPayment = { ...formPayment, id: 91, to_place: "Зарплата" };
assert.equal(isSalaryCalculationRow(salaryDestinationPayment), true);
assert.equal(groupSalaryRowsByEmployee([salaryDestinationPayment])[0].employee, "Иван Сотников");
assert.equal(groupSalaryRowsByEmployee([formPayment, salaryDestinationPayment])[0].total, 5000);
assert.equal(groupSalaryRowsByEmployee([{ ...salaryDestinationPayment, comment: "з/п Павел; Алексей" }])[0].employee, "Павел");
assert.equal(groupSalaryRowsByMonth([salaryDestinationPayment])[0].total, 2500);

const installation = {
  id: 100, created_at: "2026-10-31T10:00:00Z", amount: 10000,
  from_place: "Касса", to_place: "Монтаж", installer_name: "Иван Сотников",
  comment: "[AUTO_ORDER_DELTA] Монтаж; 1599_О; Май Клиент; улица Март; оплатил [__] → Касса; сумма 10000; 12:00; Алексей",
};
assert.equal(isInstallationSalaryRow(installation), true);
assert.equal(isSalaryCalculationRow(installation), true);
assert.equal(installationSalaryOrderId(installation), 1599);
assert.equal(groupSalaryRowsByMonth([installation])[0].monthKey, "2026-10");
assert.equal(groupSalaryRowsByEmployee([installation])[0].employee, "Иван Сотников");
const reduction = { ...installation, id: 101, amount: -2000 };
assert.equal(groupSalaryRowsByMonth([installation, reduction])[0].total, 8000);
const refund = { ...installation, id: 102, from_place: "Монтаж", to_place: "Касса" };
assert.equal(salaryCalculationAmount(refund), -10000);
assert.equal(groupSalaryRowsByMonth([installation, refund])[0].total, 0);
const changedPayer = { ...installation, id: 103, from_place: "Вова", amount: 12000 };
assert.equal(groupSalaryRowsByMonth([installation, refund, changedPayer])[0].total, 12000);
assert.equal(groupSalaryRowsByEmployee([installation, refund, changedPayer])[0].total, 12000);
assert.equal(groupSalaryRowsByEmployee([installation, { ...salaryDestinationPayment, amount: 500 }])[0].total, 10500);
assert.equal(isSalaryCalculationRow({ ...installation, deleted_at: "2026-10-31" }), false);
assert.equal(isSalaryCalculationRow({ ...installation, comment: "[AUTO_ORDER_DELTA] Предоплата; 1599; клиент ЗП" }), false);
assert.equal(isSalaryCalculationRow({ ...installation, comment: "[AUTO_EXCESS_DELTA] Монтаж; 1599; ЗП" }), false);
assert.equal(groupSalaryRowsByEmployee([{ ...installation, installer_name: "" }])[0].employee, "Монтажник не указан");
console.log("installation salary deltas: payment, decrease, refund, payer change, employee and month passed");
