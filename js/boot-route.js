/**
 * Ранний показ нужного раздела до main.js (дефернутый module).
 * Логика URL — только через getRouteSectionFromUrl (app-routes.js).
 */
import { getRouteSectionFromUrl } from "./app-routes.js";

const BOOT_LABELS = {
  all: "Заказы",
  new: "Новый",
  calculations: "Расчеты",
  excess: "Излишки",
  "tasks-all": "Мои задачи",
  "changes-all": "Все изменения",
  balance: "Баланс",
  "manager-salary": "Зарплата менеджера",
  "route-sheet": "Маршрутный лист",
  settings: "Настройки",
  statistics: "Статистика",
  "statistics-balance": "Статистика баланса",
  debts: "Долги",
  "order-tasks": "Задачи",
  messages: "Чаты",
  voice: "Голосовое управление",
};

function applyBootRoute() {
  let sec = "all";
  try {
    sec = getRouteSectionFromUrl();
  } catch {
    sec = "all";
  }

  document.querySelectorAll(".container > section.content-section").forEach((el) => {
    el.classList.remove("active");
  });

  const target = document.getElementById(`section-${sec}`) || document.getElementById("section-all");
  if (target) target.classList.add("active");

  const label = document.getElementById("sectionNavCurrentLabel");
  if (label) label.textContent = BOOT_LABELS[sec] ?? sec;

  document.documentElement.setAttribute("data-route-boot", "1");
}

applyBootRoute();
