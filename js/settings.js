import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import { isAdmin } from "./roles.js";
import { checkDatabaseAvailable, setDbUnavailableBannerVisible } from "./dbHealth.js";
import { tryParseRublesInteger } from "./format.js";

const KEY_INSTALLER_RATE = "installer_rate_per_m2";
const DEFAULT_RATE = 1400;

/** Поля корректировок баланса: ключ в app_settings и id поля ввода. */
export const BALANCE_ADJ_FIELDS = [
  { participant: "Дима", settingKey: "balance_adj_dima", inputId: "settings_adj_dima" },
  { participant: "Вова", settingKey: "balance_adj_vova", inputId: "settings_adj_vova" },
  { participant: "Касса", settingKey: "balance_adj_kassa", inputId: "settings_adj_kassa" },
  { participant: "Безнал", settingKey: "balance_adj_beznal", inputId: "settings_adj_beznal" },
];

/** 0 для пустого/частичного ввода; NaN при недопустимом формате (дробь, буквы и т.д.). */
export function parseAdjustmentInt(raw) {
  const s = String(raw ?? "").trim();
  if (s === "" || s === "-" || s === "+") return 0;
  const r = tryParseRublesInteger(raw, { allowSign: true });
  if (r.invalidFormat) return NaN;
  return r.value ?? 0;
}

/** Загрузить настройки из БД и обновить state и поля на странице. */
export async function loadSettings() {
  const keys = [KEY_INSTALLER_RATE, ...BALANCE_ADJ_FIELDS.map((f) => f.settingKey)];
  let rows;
  let error;
  if (await checkDatabaseAvailable()) {
    const res = await supabaseClient.from("app_settings").select("key, value").in("key", keys);
    rows = res.data;
    error = res.error;
    if (error) setDbUnavailableBannerVisible(true);
    else setDbUnavailableBannerVisible(false);
  } else {
    setDbUnavailableBannerVisible(true);
    rows = null;
    error = { message: "unreachable" };
  }

  const byKey = Object.fromEntries((rows || []).map((r) => [r.key, r.value]));

  const rateVal = error ? null : byKey[KEY_INSTALLER_RATE];
  const rateNum = rateVal != null && rateVal !== "" ? parseFloat(rateVal) : null;
  state.defaultInstallerRatePerM2 = Number.isFinite(rateNum) ? rateNum : DEFAULT_RATE;

  for (const { participant, settingKey } of BALANCE_ADJ_FIELDS) {
    const raw = byKey[settingKey];
    const n = raw != null && raw !== "" ? parseInt(String(raw).trim(), 10) : 0;
    state.balanceAdjustments[participant] = Number.isFinite(n) ? n : 0;
  }

  const rateInput = document.getElementById("installer_rate_per_m2");
  if (rateInput) rateInput.value = String(state.defaultInstallerRatePerM2);

  const settingsRateInput = document.getElementById("settings_installer_rate_per_m2");
  if (settingsRateInput) settingsRateInput.value = String(state.defaultInstallerRatePerM2);

  for (const { participant, inputId } of BALANCE_ADJ_FIELDS) {
    const el = document.getElementById(inputId);
    if (el) el.value = String(state.balanceAdjustments[participant] ?? 0);
  }

  updateSettingsSaveButtonState();
  updateAdjustmentsSaveButtonState();
  return state.defaultInstallerRatePerM2;
}

/** Обновить активность кнопки «Сохранить»: неактивна (серая), когда значение совпадает с сохранённым. */
export function updateSettingsSaveButtonState() {
  const input = document.getElementById("settings_installer_rate_per_m2");
  const btn = document.getElementById("settingsSaveInstallerRateBtn");
  if (!input || !btn) return;
  const r = tryParseRublesInteger(input.value);
  const saved = state.defaultInstallerRatePerM2 ?? DEFAULT_RATE;
  const trimmed = String(input.value).trim();
  const isDirty =
    r.invalidFormat ||
    (trimmed === "" ? true : r.value !== saved);
  btn.disabled = !isDirty;
  btn.classList.toggle("settings-save-btn-inactive", !isDirty);
}

/** Кнопка «Сохранить» у блока корректировок: активна только при отличии от сохранённых значений. */
export function updateAdjustmentsSaveButtonState() {
  const btn = document.getElementById("settingsSaveAdjustmentsBtn");
  if (!btn) return;
  let isDirty = false;
  for (const { participant, inputId } of BALANCE_ADJ_FIELDS) {
    const el = document.getElementById(inputId);
    if (!el) continue;
    const current = parseAdjustmentInt(el.value);
    if (Number.isNaN(current)) {
      isDirty = true;
      break;
    }
    const saved = state.balanceAdjustments[participant] ?? 0;
    if (current !== saved) {
      isDirty = true;
      break;
    }
  }
  btn.disabled = !isDirty;
  btn.classList.toggle("settings-save-btn-inactive", !isDirty);
}

/** Сохранить стоимость монтажа 1м² в БД и обновить state и поля. */
export async function saveInstallerRate(value) {
  if (!isAdmin()) return false;

  const r = tryParseRublesInteger(value);
  if (r.invalidFormat || r.value == null || r.value < 0) return false;

  const num = r.value;
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

/** Сохранить корректировки баланса в БД и state. */
export async function saveBalanceAdjustments() {
  if (!isAdmin()) return false;

  const upsertRows = [];
  for (const { participant, settingKey, inputId } of BALANCE_ADJ_FIELDS) {
    const el = document.getElementById(inputId);
    const v = parseAdjustmentInt(el?.value);
    if (Number.isNaN(v)) return false;
    upsertRows.push({ key: settingKey, value: String(v) });
  }

  const { error } = await supabaseClient.from("app_settings").upsert(upsertRows, { onConflict: "key" });

  if (error) return false;

  for (const { participant, inputId } of BALANCE_ADJ_FIELDS) {
    const el = document.getElementById(inputId);
    const v = parseAdjustmentInt(el?.value);
    state.balanceAdjustments[participant] = Number.isNaN(v) ? 0 : v;
  }

  updateAdjustmentsSaveButtonState();
  return true;
}

export function getDefaultInstallerRatePerM2() {
  return state.defaultInstallerRatePerM2 ?? DEFAULT_RATE;
}
