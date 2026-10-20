import assert from "node:assert/strict";
import { buildStatisticsMatrix, statisticsPageLabel, STATISTICS_MATRIX_USERS } from "../js/statistics-matrix.js";

assert.deepEqual(STATISTICS_MATRIX_USERS, ["Дима", "Лена", "Кристина", "Андрей", "Вова", "Алексей"]);
assert.equal(statisticsPageLabel("/messages?chat=abc"), "Чаты");
assert.equal(statisticsPageLabel("/new?order_id=123"), "Новый заказ");
assert.equal(statisticsPageLabel("/#statistics"), "Статистика входов");

const matrix = buildStatisticsMatrix([
  { user_email: "golubintsev26@gmail.com", page_path: "/messages?chat=one" },
  { user_email: "golubintsev26@gmail.com", page_path: "/messages?chat=two" },
  { user_email: "alenushka191179@gmail.com", page_path: "/messages" },
  { user_email: "golubintsev@gmail.com", page_path: "/new?order_id=1" },
  { user_email: "lexa@mail.ru", page_path: "/new?order_id=2" },
  { user_email: "animashka89@gmail.com", page_path: "/new" },
]);

assert.deepEqual(matrix, [
  {
    page: "Новый заказ",
    counts: { Дима: 0, Лена: 0, Кристина: 0, Андрей: 0, Вова: 0, Алексей: 2 },
  },
  {
    page: "Чаты",
    counts: { Дима: 2, Лена: 1, Кристина: 0, Андрей: 0, Вова: 0, Алексей: 0 },
  },
]);

console.log("statistics matrix tests: ok");
