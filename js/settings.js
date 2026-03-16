import { supabaseClient } from "./config.js";
import { state } from "./state.js";

const KEY_INSTALLER_RATE = "installer_rate_per_m2";
const DEFAULT_RATE = 1400;

/** Загрузить настройки из БД и обновить state и поля на странице. */
export async function loadSettings() {
  const { data, error } = await supabaseClient
    .from("app_settings")
    .select("key, value")
    .eq("key", KEY_INSTALLER_RATE)
    .maybeSingle();

  const value = error ? null : data?.value;
  const num = value != null && value !== "" ? parseFloat(value) : null;
  state.defaultInstallerRatePerM2 = Number.isFinite(num) ? num : DEFAULT_RATE;

  const rateInput = document.getElementById("installer_rate_per_m2");
  if (rateInput) rateInput.value = String(state.defaultInstallerRatePerM2);

  const settingsRateInput = document.getElementById("settings_installer_rate_per_m2");
  if (settingsRateInput) settingsRateInput.value = String(state.defaultInstallerRatePerM2);

  updateSettingsSaveButtonState();
  return state.defaultInstallerRatePerM2;
}

/** Обновить активность кнопки «Сохранить»: неактивна (серая), когда значение совпадает с сохранённым. */
export function updateSettingsSaveButtonState() {
  const input = document.getElementById("settings_installer_rate_per_m2");
  const btn = document.getElementById("settingsSaveInstallerRateBtn");
  if (!input || !btn) return;
  const current = parseFloat(input.value);
  const saved = state.defaultInstallerRatePerM2 ?? DEFAULT_RATE;
  const isDirty = !Number.isFinite(current) || current !== saved;
  btn.disabled = !isDirty;
  btn.classList.toggle("settings-save-btn-inactive", !isDirty);
}

/** Сохранить стоимость монтажа 1м² в БД и обновить state и поля. */
export async function saveInstallerRate(value) {
  const num = parseFloat(value);
  if (!Number.isFinite(num) || num < 0) return false;

  const valueStr = String(num);
  const { error } = await supabaseClient
    .from("app_settings")
    .upsert({ key: KEY_INSTALLER_RATE, value: valueStr }, { onConflict: "key" });

  if (error) return false;

  state.defaultInstallerRatePerM2 = num;
  const rateInput = document.getElementById("installer_rate_per_m2");
  if (rateInput) rateInput.value = valueStr;
  updateSettingsSaveButtonState();
  return true;
}

export function getDefaultInstallerRatePerM2() {
  return state.defaultInstallerRatePerM2 ?? DEFAULT_RATE;
}
