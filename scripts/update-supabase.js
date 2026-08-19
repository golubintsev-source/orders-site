/**
 * Обновление локальной копии supabase-js (js/vendor/supabase.js).
 *
 *   node scripts/update-supabase.js          # последняя версия 2.x
 *   node scripts/update-supabase.js 2.115.0  # конкретная версия
 *
 * Библиотека лежит в репозитории, а не грузится с CDN: сторонний домен в
 * критическом пути замедлял открытие PWA и не попадал в кэш service worker.
 */
const fs = require("fs");
const path = require("path");

const TARGET = path.join(__dirname, "..", "js", "vendor", "supabase.js");
const requested = process.argv[2] || "2";
const url = `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@${requested}/dist/umd/supabase.js`;

function header(version) {
  return [
    `/* Локальная копия @supabase/supabase-js UMD ${version} (dist/umd/supabase.js).`,
    " * Раньше грузилась с cdn.jsdelivr.net: сторонний origin в критическом пути (DNS + TLS +",
    " * редирект @2 → точная версия) и мимо кэша service worker.",
    " * Обновление: node scripts/update-supabase.js [версия]",
    " */",
    "",
  ].join("\n");
}

(async () => {
  console.log(`Скачиваю ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    console.error(`Не удалось скачать: HTTP ${res.status}. Проверьте номер версии.`);
    process.exit(1);
  }

  const body = await res.text();
  // Для «2» jsdelivr сам выбирает свежий релиз и сообщает его в заголовке.
  const version = res.headers.get("x-jsd-version") || requested;

  if (!body.includes("createClient")) {
    console.error("В ответе нет createClient — похоже, скачался не тот файл. Файл не изменён.");
    process.exit(1);
  }

  const previous = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, "utf8") : "";
  const previousVersion = previous.match(/UMD ([0-9]+\.[0-9]+\.[0-9]+)/)?.[1] || "нет";

  fs.mkdirSync(path.dirname(TARGET), { recursive: true });
  fs.writeFileSync(TARGET, header(version) + body);

  const kb = Math.round(Buffer.byteLength(body) / 1024);
  console.log(`Готово: ${previousVersion} → ${version} (${kb} КБ) в js/vendor/supabase.js`);
  console.log("Дальше: проверьте вход на сайте, затем git add / commit / push.");
})();
