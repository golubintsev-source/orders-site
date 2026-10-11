import { initCalculationsPage } from "./calculations.js";

void initCalculationsPage().catch((error) => {
  console.error("Не удалось открыть расчёты:", error);
});
