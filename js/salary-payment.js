import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import { canEditManualCalculations, canAccessSection } from "./roles.js";
import { tryParseRublesInteger } from "./format.js";
import { shortLoginByEmail } from "./user-names.js";

/** Список получателей в порядке разделов настроек. */
export function salaryRecipientGroups(settings = state) {
  const seen = new Set();
  return [
    { label: "Водитель", names: [settings.driverName] },
    { label: "Монтажники", names: settings.editors || [] },
    { label: "Другие работники", names: settings.otherWorkers || [] },
  ].map(({ label, names }) => ({ label, names: names.map(name => String(name || "").trim())
    .filter(name => {
      const key = name.toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
      if (!name || seen.has(key)) return false;
      seen.add(key);
      return true;
    }) })).filter(group => group.names.length);
}

export function buildSalaryPayment({ amount, recipient, comment = "" }, settings = state) {
  const parsed = tryParseRublesInteger(amount);
  if (parsed.invalidFormat || !Number.isSafeInteger(parsed.value) || parsed.value <= 0) {
    throw new Error("Укажите положительную сумму в целых рублях");
  }
  const name = String(recipient || "").trim();
  if (!salaryRecipientGroups(settings).some(group => group.names.includes(name))) {
    throw new Error("Выберите получателя из настроек");
  }
  const text = String(comment || "").trim();
  const description = `з/п ${name}${text ? `, ${text}` : ""}`;
  return {
    from_place: "Касса", to_place: "Зарплата", amount: parsed.value,
    comment: `${description}; ${shortLoginByEmail(settings.currentUser?.email || "")}`,
    created_at: new Date().toISOString(),
  };
}

let saving = false;
export async function saveSalaryPayment(values) {
  if (saving) return { ok: false, message: "Выплата уже сохраняется" };
  if (!canAccessSection("all-salaries") || !canEditManualCalculations()) {
    return { ok: false, message: "Добавление выплат недоступно для вашей роли" };
  }
  saving = true;
  try {
    const payload = buildSalaryPayment(values);
    const { error } = await supabaseClient.from("calculations").insert([payload]);
    if (error) return { ok: false, message: "Не удалось сохранить выплату в расчётах" };
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error?.message || "Не удалось сохранить выплату" };
  } finally {
    saving = false;
  }
}
