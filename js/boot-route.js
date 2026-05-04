/**
 * Ранний показ нужного раздела до main.js (дефернутый module).
 * Логика URL — только через getRouteSectionFromUrl (app-routes.js).
 */
import { getRouteSectionFromUrl } from "./app-routes.js";

const BOOT_LABELS = {
  all: "Заказы4",
  new: "Новый",
  calculations: "Расчеты",
  "tasks-all": "Все задачи",
  "changes-all": "Все изменения",
  balance: "Баланс",
  "route-sheet": "Маршрутный лист",
  settings: "Настройки",
  "order-tasks": "Задачи",
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
