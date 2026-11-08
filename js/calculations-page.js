import { initCalculationsPage } from "./calculations.js";

void initCalculationsPage().catch((error) => {
  console.error("Не удалось открыть расчёты:", error);
  const message = document.getElementById("calculationsMessage");
  if (message) message.textContent = "Не удалось загрузить расчёты с сервера.";
});
