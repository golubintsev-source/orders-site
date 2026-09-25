import { supabaseClient } from "./config.js";
import { formatAmount } from "./format.js";
import { getCalcDisplayAuthor, getCalcDisplayComment } from "./calculations.js";
import { fetchAllSupabaseRows } from "./supabase-fetch.js";
import { groupSalaryRowsByMonth, SALARY_COMMENT_TERMS } from "./all-salaries-utils.js";

const MONTH_NAMES = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

let salaryGroups = [];
let loadGeneration = 0;
let allSalariesLoadPromise = null;
const expandedMonthKeys = new Set();

function escapeHtml(value) {
  if (value == null) return "";
  const div = document.createElement("div");
  div.textContent = String(value);
  return div.innerHTML;
}

function formatSalaryMonth(monthKey) {
  const [year, month] = String(monthKey).split("-").map(Number);
  if (!year || !month || !MONTH_NAMES[month - 1]) return monthKey;
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function formatSalaryDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function renderSalaryDetails(group) {
  const rows = group.rows
    .map((row) => {
      const author = getCalcDisplayAuthor(row.comment) || "—";
      const comment = getCalcDisplayComment(row.comment) || "—";
      return `
        <tr>
          <td>${escapeHtml(formatSalaryDate(row.created_at))}</td>
          <td>${escapeHtml(author)}</td>
          <td>${escapeHtml(row.from_place || "—")}</td>
          <td>${escapeHtml(row.to_place || "—")}</td>
          <td>${escapeHtml(comment)}</td>
          <td class="all-salaries-detail-amount">${escapeHtml(formatAmount(row.amount))}&nbsp;₽</td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="all-salaries-details" id="allSalariesDetails-${group.monthKey}">
      <div class="all-salaries-details-scroll">
        <table class="all-salaries-detail-table">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Автор</th>
              <th>От кого</th>
              <th>Кому</th>
              <th>Комментарий</th>
              <th>Сумма</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function salaryRowsWord(count) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return "выплат";
  if (mod10 === 1) return "выплата";
  if (mod10 >= 2 && mod10 <= 4) return "выплаты";
  return "выплат";
}

function renderAllSalaries() {
  const tbody = document.querySelector("#allSalariesTable tbody");
  const message = document.getElementById("allSalariesMessage");
  if (!tbody) return;

  if (!salaryGroups.length) {
    tbody.innerHTML = '<tr><td colspan="2" class="all-salaries-empty">Выплат зарплаты пока нет.</td></tr>';
    if (message) message.textContent = "";
    return;
  }

  tbody.innerHTML = salaryGroups
    .map((group) => {
      const expanded = expandedMonthKeys.has(group.monthKey);
      if (expanded) {
        return `
          <tr class="all-salaries-month-row all-salaries-month-row--expanded">
            <th scope="row">${escapeHtml(formatSalaryMonth(group.monthKey))}</th>
            <td>
              <div class="all-salaries-details-toolbar">
                <span>${group.rows.length} ${salaryRowsWord(group.rows.length)}</span>
                <button type="button" class="all-salaries-collapse-btn" data-month-key="${group.monthKey}">Свернуть</button>
              </div>
            </td>
          </tr>
          <tr class="all-salaries-details-row">
            <td colspan="2">${renderSalaryDetails(group)}</td>
          </tr>
        `;
      }
      return `
        <tr class="all-salaries-month-row">
          <th scope="row">${escapeHtml(formatSalaryMonth(group.monthKey))}</th>
          <td>
            <button
             type="button"
             class="all-salaries-total-btn"
             data-month-key="${group.monthKey}"
             aria-expanded="false"
             aria-controls="allSalariesDetails-${group.monthKey}"
            >${escapeHtml(formatAmount(group.total))}&nbsp;₽</button>
          </td>
        </tr>
      `;
    })
    .join("");

  if (message) message.textContent = "";
}

function toggleSalaryMonth(monthKey) {
  if (!monthKey) return;
  if (expandedMonthKeys.has(monthKey)) expandedMonthKeys.delete(monthKey);
  else expandedMonthKeys.add(monthKey);
  renderAllSalaries();
}

let sectionBound = false;

export function initAllSalariesSection() {
  if (sectionBound) return;
  sectionBound = true;
  const table = document.getElementById("allSalariesTable");
  table?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-month-key]");
    if (!button || !table.contains(button)) return;
    toggleSalaryMonth(button.dataset.monthKey);
  });
}

async function loadAllSalariesOnce() {
  const tbody = document.querySelector("#allSalariesTable tbody");
  const message = document.getElementById("allSalariesMessage");
  if (!tbody) return;

  const generation = ++loadGeneration;
  tbody.innerHTML = '<tr><td colspan="2" class="all-salaries-empty">Загрузка…</td></tr>';
  if (message) {
    message.textContent = "";
    message.classList.remove("all-salaries-message--error");
  }

  let data = null;
  let error = null;
  try {
    ({ data, error } = await fetchAllSupabaseRows(() =>
      supabaseClient
        .from("calculations")
        .select("id, created_at, from_place, to_place, amount, comment, deleted_at")
        .is("deleted_at", null)
        .or(SALARY_COMMENT_TERMS.map((term) => `comment.ilike.%${term}%`).join(","))
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }),
    ));
  } catch (loadError) {
    error = loadError;
  }

  if (generation !== loadGeneration) return;
  if (error) {
    console.error("Ошибка загрузки всех зарплат:", error);
    salaryGroups = [];
    tbody.innerHTML = "";
    if (message) {
      message.textContent = "Не удалось загрузить выплаты зарплаты.";
      message.classList.add("all-salaries-message--error");
    }
    return;
  }

  salaryGroups = groupSalaryRowsByMonth(data || []);
  const availableKeys = new Set(salaryGroups.map((group) => group.monthKey));
  for (const key of expandedMonthKeys) {
    if (!availableKeys.has(key)) expandedMonthKeys.delete(key);
  }
  renderAllSalaries();
}

/** Один запрос за раз: первоначальная маршрутизация и инициализация могут совпасть. */
export function loadAllSalaries() {
  if (allSalariesLoadPromise) return allSalariesLoadPromise;
  const current = loadAllSalariesOnce();
  allSalariesLoadPromise = current;
  return current.finally(() => {
    if (allSalariesLoadPromise === current) allSalariesLoadPromise = null;
  });
}
