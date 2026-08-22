import { supabaseClient, isOfflineWorkModeEnabled } from "./config.js";
import { state } from "./state.js";
import { isAdmin } from "./roles.js";
import { tryParseRublesInteger, formatAmount } from "./format.js";
import { readSnapshot, persistSettingsSnapshotFromRows } from "./offline-cache.js";

const KEY_INSTALLER_RATE = "installer_rate_per_m2";
const KEY_DRIVER_NAME = "driver_name";
const KEY_EDITORS = "editors";
const DEFAULT_RATE = 1400;
const DEFAULT_MANAGER_SALARY_BASE = 22000;
const DEFAULT_MANAGER_SALARY_PERCENT = 1.5;

const EDITOR_REMOVE_BTN_HTML =
  '<span aria-hidden="true">×</span>';

/** Поля корректировок баланса: ключ в app_settings и id поля ввода. */
export const BALANCE_ADJ_FIELDS = [
  { participant: "Дима", settingKey: "balance_adj_dima", inputId: "settings_adj_dima" },
  { participant: "Вова", settingKey: "balance_adj_vova", inputId: "settings_adj_vova" },
  { participant: "Касса", settingKey: "balance_adj_kassa", inputId: "settings_adj_kassa" },
  { participant: "Безнал", settingKey: "balance_adj_beznal", inputId: "settings_adj_beznal" },
];

/** Поля параметров зарплаты менеджера: фиксированная сумма и процент 0…100. */
export const MANAGER_SALARY_PARAM_FIELDS = [
  {
    managerId: "kristina",
    name: "Кристина",
    baseKey: "manager_salary_kristina_base",
    percentKey: "manager_salary_kristina_percent",
    baseInputId: "settings_salary_kristina_base",
    percentInputId: "settings_salary_kristina_percent",
  },
  {
    managerId: "andrey",
    name: "Андрей",
    baseKey: "manager_salary_andrey_base",
    percentKey: "manager_salary_andrey_percent",
    baseInputId: "settings_salary_andrey_base",
    percentInputId: "settings_salary_andrey_percent",
  },
];

const MANAGER_SALARY_PERCENT_INVALID_TITLE =
  "Процент — число от 0 до 100. Можно указать дробь, например 1,5.";

/** 0 для пустого/частичного ввода; NaN при недопустимом формате (дробь, буквы и т.д.). */
export function parseAdjustmentInt(raw) {
  const s = String(raw ?? "").trim();
  if (s === "" || s === "-" || s === "+") return 0;
  const r = tryParseRublesInteger(raw, { allowSign: true });
  if (r.invalidFormat) return NaN;
  return r.value ?? 0;
}

/** Разбор фиксированной суммы з/п: целые рубли ≥ 0; пусто = 0; NaN при ошибке. */
export function parseManagerSalaryBase(raw) {
  const r = tryParseRublesInteger(raw);
  if (r.invalidFormat) return NaN;
  const n = r.value ?? 0;
  return n >= 0 ? n : NaN;
}

/**
 * Разбор процента з/п: 0…100, дробь через точку или запятую.
 * Пусто = 0; NaN при ошибке формата или вне диапазона.
 */
export function parseManagerSalaryPercent(raw) {
  const s = String(raw ?? "").trim();
  if (s === "" || s === "." || s === ",") return 0;
  const compact = s.replace(/[\s\u00A0\u202F]/g, "").replace(",", ".");
  if (!/^\d+(\.\d*)?$/.test(compact)) return NaN;
  const n = Number(compact);
  if (!Number.isFinite(n) || n < 0 || n > 100) return NaN;
  return n;
}

function formatPercentSettingValue(n) {
  if (!Number.isFinite(n)) return "";
  return String(n).replace(".", ",");
}

function normalizeSalaryPercent(n) {
  if (!Number.isFinite(n)) return DEFAULT_MANAGER_SALARY_PERCENT;
  return Math.round(n * 10000) / 10000;
}

function parseStoredSalaryBase(raw) {
  if (raw == null || raw === "") return DEFAULT_MANAGER_SALARY_BASE;
  const n = parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MANAGER_SALARY_BASE;
}

function parseStoredSalaryPercent(raw) {
  if (raw == null || raw === "") return DEFAULT_MANAGER_SALARY_PERCENT;
  const n = Number(String(raw).trim().replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 100) return DEFAULT_MANAGER_SALARY_PERCENT;
  return normalizeSalaryPercent(n);
}

export function refreshPercentInputState(el, raw) {
  if (!el) return;
  const s = String(raw ?? "").trim();
  if (!s) {
    el.classList.remove("sum-input-invalid");
    el.removeAttribute("title");
    el.removeAttribute("aria-invalid");
    return;
  }
  if (Number.isNaN(parseManagerSalaryPercent(raw))) {
    el.classList.add("sum-input-invalid");
    el.title = MANAGER_SALARY_PERCENT_INVALID_TITLE;
    el.setAttribute("aria-invalid", "true");
    return;
  }
  el.classList.remove("sum-input-invalid");
  el.removeAttribute("title");
  el.removeAttribute("aria-invalid");
}

function defaultManagerSalaryParams() {
  return {
    kristina: { base: DEFAULT_MANAGER_SALARY_BASE, percent: DEFAULT_MANAGER_SALARY_PERCENT },
    andrey: { base: DEFAULT_MANAGER_SALARY_BASE, percent: DEFAULT_MANAGER_SALARY_PERCENT },
  };
}

export function getManagerSalaryParams(managerId) {
  const id = managerId === "andrey" ? "andrey" : "kristina";
  const saved = state.managerSalaryParams?.[id];
  return {
    base: Number.isFinite(saved?.base) ? saved.base : DEFAULT_MANAGER_SALARY_BASE,
    percent: Number.isFinite(saved?.percent) ? normalizeSalaryPercent(saved.percent) : DEFAULT_MANAGER_SALARY_PERCENT,
  };
}

function notifyManagerSalaryParamsChanged() {
  if (typeof document === "undefined") return;
  document.dispatchEvent(new CustomEvent("manager-salary-params-updated"));
}

/** На мобильной numeric-клавиатуре часто нет «−» — переключаем знак кнопкой ±. */
export function toggleAdjustmentSign(input) {
  if (!input) return;
  const s = String(input.value ?? "").trim();
  let next;
  if (s.startsWith("-")) {
    next = s.slice(1);
  } else if (s === "" || s === "+" || /^0+$/.test(s)) {
    next = "-";
  } else if (s.startsWith("+")) {
    next = `-${s.slice(1)}`;
  } else {
    next = `-${s}`;
  }
  input.value = next;
  // iOS Safari иногда не перерисовывает value у сфокусированного поля.
  try {
    if (typeof input.setSelectionRange === "function") {
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
  } catch {
    /* ignore */
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

export function syncAdjustmentSignButton(input) {
  if (!input?.id) return;
  const btn = document.querySelector(
    `.settings-adj-sign-btn[data-adj-input="${input.id}"], .excess-change-sign-btn[data-adj-input="${input.id}"]`,
  );
  if (!btn) return;
  const negative = String(input.value ?? "").trim().startsWith("-");
  btn.setAttribute("aria-pressed", negative ? "true" : "false");
  btn.title = negative ? "Сейчас минус — нажмите для плюса" : "Сменить знак (+/−)";
}

function normalizeDriverName(raw) {
  return String(raw ?? "").trim().replace(/\s+/g, " ");
}

function normalizeEditorName(raw) {
  return String(raw ?? "").trim().replace(/\s+/g, " ");
}

/** Разобрать значение настройки editors (JSON-массив строк). */
export function parseEditorsSettingValue(raw) {
  if (raw == null || raw === "") return [];
  if (Array.isArray(raw)) {
    return raw.map(normalizeEditorName).filter(Boolean);
  }
  const s = String(raw).trim();
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeEditorName).filter(Boolean);
  } catch {
    // На случай старого/ручного формата «Имя; Имя» или по строкам
    return s
      .split(/[\n;|]+/)
      .map(normalizeEditorName)
      .filter(Boolean);
  }
}

function editorsListsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Имена из полей формы: пустые строки сохраняются как слоты UI. */
function collectEditorInputsFromDom({ onlyFilled = false } = {}) {
  const list = document.getElementById("settingsEditorsList");
  if (!list) return [];
  const values = [];
  list.querySelectorAll(".settings-editor-input").forEach((el) => {
    const name = normalizeEditorName(el.value);
    if (onlyFilled && !name) return;
    values.push(onlyFilled ? name : String(el.value ?? ""));
  });
  return values;
}

function createEditorRow(initialValue = "") {
  const row = document.createElement("div");
  row.className = "settings-editor-row";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "settings-editor-input";
  input.autocomplete = "off";
  input.placeholder = "Имя Отчество";
  input.title = "Имя и отчество монтажника";
  input.value = initialValue;

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "settings-editor-remove-btn";
  removeBtn.title = "Удалить монтажника";
  removeBtn.setAttribute("aria-label", "Удалить монтажника");
  removeBtn.innerHTML = EDITOR_REMOVE_BTN_HTML;

  row.appendChild(input);
  row.appendChild(removeBtn);
  return row;
}

/** Отрисовать список полей редакторов. */
export function renderEditorsList(names) {
  const list = document.getElementById("settingsEditorsList");
  if (!list) return;
  const items = Array.isArray(names) ? names : [];
  list.innerHTML = "";
  for (const name of items) {
    list.appendChild(createEditorRow(name));
  }
}

/** Добавить пустое поле редактора. */
export function addEditorField() {
  const list = document.getElementById("settingsEditorsList");
  if (!list) return;
  const row = createEditorRow("");
  list.appendChild(row);
  const input = row.querySelector(".settings-editor-input");
  if (input instanceof HTMLInputElement) {
    queueMicrotask(() => input.focus());
  }
  updateEditorsSaveButtonState();
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
  state.editors = parseEditorsSettingValue(byKey[KEY_EDITORS]);

  for (const { participant, settingKey } of BALANCE_ADJ_FIELDS) {
    const raw = byKey[settingKey];
    const n = raw != null && raw !== "" ? parseInt(String(raw).trim(), 10) : 0;
    state.balanceAdjustments[participant] = Number.isFinite(n) ? n : 0;
  }

  const nextSalaryParams = defaultManagerSalaryParams();
  for (const { managerId, baseKey, percentKey } of MANAGER_SALARY_PARAM_FIELDS) {
    nextSalaryParams[managerId] = {
      base: parseStoredSalaryBase(byKey[baseKey]),
      percent: parseStoredSalaryPercent(byKey[percentKey]),
    };
  }
  state.managerSalaryParams = nextSalaryParams;

  const rateInput = document.getElementById("installer_rate_per_m2");
  if (rateInput) rateInput.value = String(state.defaultInstallerRatePerM2);

  const settingsRateInput = document.getElementById("settings_installer_rate_per_m2");
  if (settingsRateInput) settingsRateInput.value = String(state.defaultInstallerRatePerM2);

  const settingsDriverInput = document.getElementById("settings_driver_name");
  if (settingsDriverInput) settingsDriverInput.value = state.driverName;

  syncRouteSheetDriverInput(state.driverName);
  renderEditorsList(state.editors);

  for (const { participant, inputId } of BALANCE_ADJ_FIELDS) {
    const el = document.getElementById(inputId);
    if (el) {
      el.value = String(state.balanceAdjustments[participant] ?? 0);
      syncAdjustmentSignButton(el);
    }
  }

  for (const { managerId, baseInputId, percentInputId } of MANAGER_SALARY_PARAM_FIELDS) {
    const params = state.managerSalaryParams[managerId] || defaultManagerSalaryParams()[managerId];
    const baseEl = document.getElementById(baseInputId);
    const percentEl = document.getElementById(percentInputId);
    if (baseEl) baseEl.value = String(params.base);
    if (percentEl) percentEl.value = formatPercentSettingValue(params.percent);
  }

  updateSettingsSaveButtonState();
  updateDriverSaveButtonState();
  updateEditorsSaveButtonState();
  updateAdjustmentsSaveButtonState();
  updateManagerSalaryParamsSaveButtonState();
  notifyManagerSalaryParamsChanged();
}

/** Загрузить настройки из БД и обновить state и поля на странице. */
export async function loadSettings() {
  if (isOfflineWorkModeEnabled() && typeof navigator !== "undefined" && navigator.onLine === false) {
    const snap = readSnapshot();
    applySettingsRowsToStateAndDom(snap?.settingsRows || []);
    return state.defaultInstallerRatePerM2;
  }

  const keys = [
    KEY_INSTALLER_RATE,
    KEY_DRIVER_NAME,
    KEY_EDITORS,
    ...BALANCE_ADJ_FIELDS.map((f) => f.settingKey),
    ...MANAGER_SALARY_PARAM_FIELDS.flatMap((f) => [f.baseKey, f.percentKey]),
  ];
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

/** Кнопка «Сохранить» у блока редакторов: активна при отличии от сохранённого списка. */
export function updateEditorsSaveButtonState() {
  const btn = document.getElementById("settingsSaveEditorsBtn");
  if (!btn) return;
  const current = collectEditorInputsFromDom({ onlyFilled: true }).map(normalizeEditorName);
  const saved = (state.editors || []).map(normalizeEditorName);
  const isDirty = !editorsListsEqual(current, saved);
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

/** Кнопка «Сохранить» у блока параметров з/п: активна при отличии или неверном вводе. */
export function updateManagerSalaryParamsSaveButtonState() {
  const btn = document.getElementById("settingsSaveSalaryParamsBtn");
  if (!btn) return;
  let isDirty = false;
  for (const { managerId, baseInputId, percentInputId } of MANAGER_SALARY_PARAM_FIELDS) {
    const baseEl = document.getElementById(baseInputId);
    const percentEl = document.getElementById(percentInputId);
    if (!baseEl || !percentEl) continue;
    const currentBase = parseManagerSalaryBase(baseEl.value);
    const currentPercent = parseManagerSalaryPercent(percentEl.value);
    if (Number.isNaN(currentBase) || Number.isNaN(currentPercent)) {
      isDirty = true;
      break;
    }
    const saved = getManagerSalaryParams(managerId);
    if (currentBase !== saved.base || normalizeSalaryPercent(currentPercent) !== saved.percent) {
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

/** Сохранить список редакторов в БД и state. */
export async function saveEditors() {
  if (!isAdmin()) return false;

  const names = collectEditorInputsFromDom({ onlyFilled: true }).map(normalizeEditorName);
  const valueStr = JSON.stringify(names);
  const { error } = await supabaseClient
    .from("app_settings")
    .upsert({ key: KEY_EDITORS, value: valueStr }, { onConflict: "key" });

  if (error) return false;

  state.editors = names;
  renderEditorsList(names);
  updateEditorsSaveButtonState();
  return true;
}

/**
 * Комментарии для settings_history: по одной строке на каждое изменение
 * (как order_history / excess_history).
 * @param {Record<string, number>} prev
 * @param {Record<string, number>} next
 * @returns {string[]}
 */
function buildBalanceAdjustmentHistoryComments(prev, next) {
  const parts = [];
  for (const { participant } of BALANCE_ADJ_FIELDS) {
    const prevVal = Number(prev?.[participant] ?? 0);
    const nextVal = Number(next?.[participant] ?? 0);
    if (prevVal === nextVal) continue;
    const prevLabel = formatAmount(prevVal) || "0";
    const nextLabel = formatAmount(nextVal) || "0";
    parts.push(`${participant}: ${prevLabel} -> ${nextLabel}`);
  }
  return parts;
}

/**
 * Записать изменения корректировок в settings_history.
 * @param {string[]} comments
 * @param {string} [userEmail]
 * @returns {Promise<{ ok: boolean, error?: unknown }>}
 */
async function insertSettingsHistoryComments(comments, userEmail) {
  const list = (comments || []).map((c) => String(c || "").trim()).filter(Boolean);
  if (list.length === 0) return { ok: true };
  const email = String(userEmail || state.currentUser?.email || "").trim();
  if (!email) {
    console.error("Ошибка записи истории корректировок: нет email пользователя");
    return { ok: false, error: { message: "Нет email пользователя для истории" } };
  }
  const rows = list.map((comment) => ({
    setting_key: "balance_adjustments",
    user_email: email,
    comment,
  }));
  const { error } = await supabaseClient.from("settings_history").insert(rows);
  if (error) {
    console.error("Ошибка записи истории корректировок:", error);
    return { ok: false, error };
  }
  return { ok: true };
}

/**
 * Сохранить корректировки баланса в БД и state.
 * @returns {Promise<{ ok: boolean, historyOk?: boolean }>}
 */
export async function saveBalanceAdjustments() {
  if (!isAdmin()) return { ok: false };

  const nextValues = {};
  const upsertRows = [];
  for (const { participant, settingKey, inputId } of BALANCE_ADJ_FIELDS) {
    const el = document.getElementById(inputId);
    const v = parseAdjustmentInt(el?.value);
    if (Number.isNaN(v)) return { ok: false };
    nextValues[participant] = v;
    upsertRows.push({ key: settingKey, value: String(v) });
  }

  const prevValues = {};
  for (const { participant } of BALANCE_ADJ_FIELDS) {
    prevValues[participant] = state.balanceAdjustments[participant] ?? 0;
  }

  const { error } = await supabaseClient.from("app_settings").upsert(upsertRows, { onConflict: "key" });

  if (error) return { ok: false };

  for (const { participant } of BALANCE_ADJ_FIELDS) {
    state.balanceAdjustments[participant] = nextValues[participant] ?? 0;
  }

  const comments = buildBalanceAdjustmentHistoryComments(prevValues, nextValues);
  let historyOk = true;
  if (comments.length > 0) {
    const hist = await insertSettingsHistoryComments(comments);
    historyOk = hist.ok;
  }

  updateAdjustmentsSaveButtonState();
  return { ok: true, historyOk };
}

/** Сохранить параметры формулы зарплаты менеджера в БД и state. */
export async function saveManagerSalaryParams() {
  if (!isAdmin()) return false;

  const nextValues = {};
  const upsertRows = [];
  for (const { managerId, baseKey, percentKey, baseInputId, percentInputId } of MANAGER_SALARY_PARAM_FIELDS) {
    const base = parseManagerSalaryBase(document.getElementById(baseInputId)?.value);
    const percent = parseManagerSalaryPercent(document.getElementById(percentInputId)?.value);
    if (Number.isNaN(base) || Number.isNaN(percent)) return false;
    const normalizedPercent = normalizeSalaryPercent(percent);
    nextValues[managerId] = { base, percent: normalizedPercent };
    upsertRows.push({ key: baseKey, value: String(base) });
    upsertRows.push({ key: percentKey, value: String(normalizedPercent) });
  }

  const { error } = await supabaseClient.from("app_settings").upsert(upsertRows, { onConflict: "key" });
  if (error) return false;

  state.managerSalaryParams = nextValues;
  for (const { managerId, baseInputId, percentInputId } of MANAGER_SALARY_PARAM_FIELDS) {
    const params = nextValues[managerId];
    const baseEl = document.getElementById(baseInputId);
    const percentEl = document.getElementById(percentInputId);
    if (baseEl) baseEl.value = String(params.base);
    if (percentEl) percentEl.value = formatPercentSettingValue(params.percent);
  }

  updateManagerSalaryParamsSaveButtonState();
  notifyManagerSalaryParamsChanged();
  return true;
}

export function getDefaultInstallerRatePerM2() {
  return state.defaultInstallerRatePerM2 ?? DEFAULT_RATE;
}

export function getDriverName() {
  return normalizeDriverName(state.driverName);
}

export function getEditors() {
  return (state.editors || []).map(normalizeEditorName).filter(Boolean);
}

/** Блоки настроек кроме уведомлений — только для админов. */
export function applySettingsAdminBlocksVisibility() {
  const showAdmin = isAdmin();
  document.querySelectorAll(".settings-admin-only").forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    // loginLinksCard управляется отдельно в login-links.js
    if (el.id === "loginLinksCard") return;
    el.hidden = !showAdmin;
  });
}
