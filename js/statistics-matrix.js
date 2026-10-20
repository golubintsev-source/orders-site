import { displayNameByEmail } from "./user-names.js";

export const STATISTICS_MATRIX_USERS = ["Дима", "Лена", "Кристина", "Андрей", "Вова", "Алексей"];

const PAGE_LABELS = new Map([
  ["/", "Заказы"],
  ["/all", "Заказы"],
  ["/new", "Новый заказ"],
  ["/calculations", "Расчеты"],
  ["/excess", "Излишки"],
  ["/debts", "Долги"],
  ["/manager-salary", "Зарплата менеджера"],
  ["/all-salaries", "Все зарплаты"],
  ["/tasks-all", "Мои задачи"],
  ["/route-sheet", "Маршрутный лист"],
  ["/contractor-checks", "Проверка контрагентов"],
  ["/balance", "Баланс"],
  ["/statistics-balance", "Статистика баланса"],
  ["/changes-all", "Все изменения"],
  ["/statistics", "Статистика входов"],
  ["/speed-test", "Тест скорости"],
  ["/settings", "Настройки"],
  ["/messages", "Чаты"],
  ["/voice", "Голосовое управление"],
  ["/order-tasks", "Задачи заказа"],
  ["/login", "Вход"],
  ["/login.html", "Вход"],
  ["/history.html", "История изменений заказа"],
]);

const PAGE_ORDER = new Map([...new Set(PAGE_LABELS.values())].map((label, index) => [label, index]));
const MATRIX_USER_SET = new Set(STATISTICS_MATRIX_USERS);

function normalizePath(path) {
  const raw = String(path || "").trim();
  if (!raw) return "/";
  try {
    const url = new URL(raw, "https://orders.local");
    const hashSection = url.hash.replace(/^#/, "");
    if (hashSection && PAGE_LABELS.has(`/${hashSection}`)) return `/${hashSection}`;
    let pathname = url.pathname || "/";
    pathname = pathname.replace(/\/index\.html$/i, "") || "/";
    if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
    return pathname;
  } catch {
    return raw.split(/[?#]/, 1)[0] || "/";
  }
}

export function statisticsPageLabel(pagePath) {
  const normalized = normalizePath(pagePath);
  return PAGE_LABELS.get(normalized) || normalized;
}

export function buildStatisticsMatrix(rows) {
  const byPage = new Map();

  for (const row of rows || []) {
    const user = displayNameByEmail(row?.user_email);
    if (!MATRIX_USER_SET.has(user)) continue;

    const page = statisticsPageLabel(row?.page_path);
    if (!byPage.has(page)) {
      byPage.set(page, Object.fromEntries(STATISTICS_MATRIX_USERS.map((name) => [name, 0])));
    }
    byPage.get(page)[user] += 1;
  }

  return [...byPage.entries()]
    .sort(([pageA], [pageB]) => {
      const orderA = PAGE_ORDER.get(pageA) ?? Number.MAX_SAFE_INTEGER;
      const orderB = PAGE_ORDER.get(pageB) ?? Number.MAX_SAFE_INTEGER;
      return orderA - orderB || pageA.localeCompare(pageB, "ru");
    })
    .map(([page, counts]) => ({ page, counts }));
}
