import { supabaseClient, isOfflineWorkModeEnabled } from "./config.js";
import { state } from "./state.js";
import { isAdmin } from "./roles.js";
import { tryParseRublesInteger } from "./format.js";
import { readSnapshot, persistSettingsSnapshotFromRows } from "./offline-cache.js";

const KEY_INSTALLER_RATE = "installer_rate_per_m2";
const KEY_DRIVER_NAME = "driver_name";
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

function normalizeDriverName(raw) {
  return String(raw ?? "").trim().replace(/\s+/g, " ");
}

/** Синхронизировать поле «Водитель» на маршрутном листе с сохранённым значением. */
function syncRouteSheetDriverInput(driverName) {
  const el = document.getElementById("routeSheetDriver");
  if (!el) return;
  // Не перезаписываем, если пользователь уже изменил значение на странице МЛ.
  if (el.dataset.userEdited === "1") return;
  el.value = driverName;
}

/** Применить строки app_settings к state и полям формы. */
function applySettingsRowsToStateAndDom(effectiveRows) {
  const byKey = Object.fromEntries((effectiveRows || []).map((r) => [r.key, r.value]));

  const rateVal = byKey[KEY_INSTALLER_RATE];
  const rateNum = rateVal != null && rateVal !== "" ? parseFloat(rateVal) : null;
  state.defaultInstallerRatePerM2 = Number.isFinite(rateNum) ? rateNum : DEFAULT_RATE;

  state.driverName = normalizeDriverName(byKey[KEY_DRIVER_NAME] ?? "");

  for (const { participant, settingKey } of BALANCE_ADJ_FIELDS) {
    const raw = byKey[settingKey];
    const n = raw != null && raw !== "" ? parseInt(String(raw).trim(), 10) : 0;
    state.balanceAdjustments[participant] = Number.isFinite(n) ? n : 0;
  }

  const rateInput = document.getElementById("installer_rate_per_m2");
  if (rateInput) rateInput.value = String(state.defaultInstallerRatePerM2);

  const settingsRateInput = document.getElementById("settings_installer_rate_per_m2");
  if (settingsRateInput) settingsRateInput.value = String(state.defaultInstallerRatePerM2);

  const settingsDriverInput = document.getElementById("settings_driver_name");
  if (settingsDriverInput) settingsDriverInput.value = state.driverName;

  syncRouteSheetDriverInput(state.driverName);

  for (const { participant, inputId } of BALANCE_ADJ_FIELDS) {
    const el = document.getElementById(inputId);
    if (el) el.value = String(state.balanceAdjustments[participant] ?? 0);
  }

  updateSettingsSaveButtonState();
  updateDriverSaveButtonState();
  updateAdjustmentsSaveButtonState();
}

/** Загрузить настройки из БД и обновить state и поля на странице. */
export async function loadSettings() {
  if (isOfflineWorkModeEnabled() && typeof navigator !== "undefined" && navigator.onLine === false) {
    const snap = readSnapshot();
    applySettingsRowsToStateAndDom(snap?.settingsRows || []);
    return state.defaultInstallerRatePerM2;
  }

  const keys = [KEY_INSTALLER_RATE, KEY_DRIVER_NAME, ...BALANCE_ADJ_FIELDS.map((f) => f.settingKey)];
  const { data: rows, error } = await supabaseClient.from("app_settings").select("key, value").in("key", keys);
  let effectiveRows = rows || [];
  if (error) {
    console.error("Ошибка загрузки настроек:", error);
  } else if (rows?.length) {
    persistSettingsSnapshotFromRows(rows);
  }

  applySettingsRowsToStateAndDom(effectiveRows);
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

/** Кнопка «Сохранить» у блока водителя: активна только при отличии от сохранённого ФИО. */
export function updateDriverSaveButtonState() {
  const input = document.getElementById("settings_driver_name");
  const btn = document.getElementById("settingsSaveDriverBtn");
  if (!input || !btn) return;
  const current = normalizeDriverName(input.value);
  const saved = normalizeDriverName(state.driverName);
  const isDirty = current !== saved;
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

/** Сохранить ФИО водителя в БД и state. */
export async function saveDriverName(value) {
  if (!isAdmin()) return false;

  const name = normalizeDriverName(value);
  const { error } = await supabaseClient
    .from("app_settings")
    .upsert({ key: KEY_DRIVER_NAME, value: name }, { onConflict: "key" });

  if (error) return false;

  state.driverName = name;
  const settingsDriverInput = document.getElementById("settings_driver_name");
  if (settingsDriverInput) settingsDriverInput.value = name;

  const routeDriver = document.getElementById("routeSheetDriver");
  if (routeDriver) {
    routeDriver.dataset.userEdited = "";
    routeDriver.value = name;
  }

  updateDriverSaveButtonState();
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

export function getDriverName() {
  return normalizeDriverName(state.driverName);
}
