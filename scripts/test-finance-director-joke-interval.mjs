import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../sql/finance_director_joke_three_day_interval.sql", import.meta.url),
  "utf8",
);
const initialSetup = readFileSync(
  new URL("../sql/finance_director_daily_jokes.sql", import.meta.url),
  "utf8",
);
const sectionNav = readFileSync(new URL("../js/section-nav.js", import.meta.url), "utf8");

for (const sql of [migration, initialSetup]) {
  assert.match(sql, /sent_at timestamptz/i, "должно храниться точное время отправки");
  assert.match(sql, /interval '72 hours'/i, "лимит должен составлять 72 часа");
  assert.match(sql, /pg_advisory_xact_lock/i, "одновременные вкладки должны быть сериализованы");
  assert.match(sql, /RETURN NULL;/, "повторная отправка внутри интервала должна отменяться");
}

assert.match(
  sectionNav,
  /sectionId === "all"[\s\S]*checkFinanceDirectorJoke\(\)/,
  "проверка должна по-прежнему запускаться только при открытии раздела заказов",
);
assert.match(sectionNav, /golubintsev26@gmail\.com/, "список разрешённых пользователей не должен меняться");

console.log("Интервал сообщений финансового директора: OK");
