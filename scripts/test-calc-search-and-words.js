/**
 * Поиск на странице расчётов: несколько слов = И (%слово1% И %слово2% …).
 * Запуск: node scripts/test-calc-search-and-words.js
 */
const fs = require("fs");
const path = require("path");

function splitCalculationsSearchTokens(query) {
  return String(query || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function haystackMatchesAllSearchTokens(haystack, query) {
  const tokens = splitCalculationsSearchTokens(query);
  if (!tokens.length) return true;
  const hay = String(haystack || "").toLowerCase();
  return tokens.every((token) => hay.includes(token));
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert.deepEqual = (a, b, msg) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
  }
};

assert.deepEqual(splitCalculationsSearchTokens(""), [], "пустой запрос → нет токенов");
assert.deepEqual(splitCalculationsSearchTokens("   "), [], "только пробелы → нет токенов");
assert.deepEqual(splitCalculationsSearchTokens("Безнал"), ["безнал"], "одно слово");
assert.deepEqual(
  splitCalculationsSearchTokens("  слово1   слово2\tслово3 "),
  ["слово1", "слово2", "слово3"],
  "несколько слов и лишние пробелы"
);

const hay = "26 авг 10:00:53 Кристина Безнал Клиент 156 575";

assert(haystackMatchesAllSearchTokens(hay, ""), "пустой запрос показывает строку");
assert(haystackMatchesAllSearchTokens(hay, "безнал"), "одно слово как %безнал%");
assert(haystackMatchesAllSearchTokens(hay, "Безнал Клиент"), "оба слова есть (порядок как в данных)");
assert(
  haystackMatchesAllSearchTokens(hay, "Клиент Безнал"),
  "оба слова есть независимо от порядка"
);
assert(
  haystackMatchesAllSearchTokens(hay, "кристина безнал клиент"),
  "три слова из разных колонок"
);
assert(
  !haystackMatchesAllSearchTokens(hay, "Безнал Покупка"),
  "нет второго слова — строка не подходит"
);
assert(
  !haystackMatchesAllSearchTokens(hay, "слово1 слово2"),
  "ни одного слова нет — строка не подходит"
);
assert(
  haystackMatchesAllSearchTokens(hay, "Безн"),
  "частичное совпадение как %Безн%"
);
assert(
  haystackMatchesAllSearchTokens("Клиент Безнал", "Безнал Клиент"),
  "переставленные «Откуда Куда» тоже находятся"
);

const root = path.join(__dirname, "..");
const calcJs = fs.readFileSync(path.join(root, "js/calculations.js"), "utf8");
assert(calcJs.includes("function splitCalculationsSearchTokens("), "в calculations.js есть splitCalculationsSearchTokens");
assert(calcJs.includes("function haystackMatchesAllSearchTokens("), "в calculations.js есть haystackMatchesAllSearchTokens");
assert(calcJs.includes("tokens.every((token) => hay.includes(token))"), "поиск нескольких слов через И (every + includes)");
assert(
  /function rowMatchesCalculationsSearch[\s\S]*haystackMatchesAllSearchTokens/.test(calcJs),
  "rowMatchesCalculationsSearch использует И-поиск по словам"
);
assert(
  !/parts\.join\(" "\)\.toLowerCase\(\)\.includes\(needleLower\)/.test(calcJs),
  "старый поиск целой фразой убран"
);

console.log("test-calc-search-and-words: ok");
