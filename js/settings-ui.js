import {
  saveInstallerRate,
  saveDriverName,
  saveEditors,
  saveBalanceAdjustments,
  saveManagerSalaryParams,
  updateSettingsSaveButtonState,
  updateDriverSaveButtonState,
  updateEditorsSaveButtonState,
  updateAdjustmentsSaveButtonState,
  updateManagerSalaryParamsSaveButtonState,
  addEditorField,
  BALANCE_ADJ_FIELDS,
  MANAGER_SALARY_PARAM_FIELDS,
  toggleAdjustmentSign,
  syncAdjustmentSignButton,
  refreshPercentInputState,
} from "./settings.js";
import { setMessage } from "./dom.js";
import { refreshRublesIntegerInputState } from "./format.js";
let bound = false;
export function bindSettingsUI() {
  if (bound) return;
  bound = true;
  const settingsSaveInstallerRateBtn = document.getElementById("settingsSaveInstallerRateBtn");
  const settingsInstallerRateInput = document.getElementById("settings_installer_rate_per_m2");
  if (settingsSaveInstallerRateBtn && settingsInstallerRateInput) {
    settingsSaveInstallerRateBtn.addEventListener("click", async () => {
      const ok = await saveInstallerRate(settingsInstallerRateInput.value);
      setMessage(ok ? "Сохранено" : "Ошибка сохранения или неверное значение", ok ? "" : "#d32f2f");
    });
    const onSettingsRateInput = () => {
      refreshRublesIntegerInputState(settingsInstallerRateInput, settingsInstallerRateInput.value);
      updateSettingsSaveButtonState();
    };
    settingsInstallerRateInput.addEventListener("input", onSettingsRateInput);
    settingsInstallerRateInput.addEventListener("change", onSettingsRateInput);
    settingsInstallerRateInput.addEventListener("blur", onSettingsRateInput);
  }

  const settingsSaveDriverBtn = document.getElementById("settingsSaveDriverBtn");
  const settingsDriverInput = document.getElementById("settings_driver_name");
  if (settingsSaveDriverBtn && settingsDriverInput) {
    settingsSaveDriverBtn.addEventListener("click", async () => {
      const ok = await saveDriverName(settingsDriverInput.value);
      setMessage(ok ? "Водитель сохранён" : "Ошибка сохранения водителя", ok ? "" : "#d32f2f");
    });
    const onDriverInput = () => updateDriverSaveButtonState();
    settingsDriverInput.addEventListener("input", onDriverInput);
    settingsDriverInput.addEventListener("change", onDriverInput);
    settingsDriverInput.addEventListener("blur", onDriverInput);
  }

  const settingsAddEditorBtn = document.getElementById("settingsAddEditorBtn");
  const settingsEditorsList = document.getElementById("settingsEditorsList");
  const settingsSaveEditorsBtn = document.getElementById("settingsSaveEditorsBtn");
  if (settingsAddEditorBtn) {
    settingsAddEditorBtn.addEventListener("click", () => {
      addEditorField();
    });
  }
  if (settingsEditorsList) {
    settingsEditorsList.addEventListener("click", (e) => {
      const removeBtn = e.target.closest(".settings-editor-remove-btn");
      if (!removeBtn || !settingsEditorsList.contains(removeBtn)) return;
      const row = removeBtn.closest(".settings-editor-row");
      row?.remove();
      updateEditorsSaveButtonState();
    });
    settingsEditorsList.addEventListener("input", (e) => {
      if (e.target instanceof HTMLInputElement && e.target.classList.contains("settings-editor-input")) {
        updateEditorsSaveButtonState();
      }
    });
    settingsEditorsList.addEventListener("change", (e) => {
      if (e.target instanceof HTMLInputElement && e.target.classList.contains("settings-editor-input")) {
        updateEditorsSaveButtonState();
      }
    });
  }
  if (settingsSaveEditorsBtn) {
    settingsSaveEditorsBtn.addEventListener("click", async () => {
      const ok = await saveEditors();
      setMessage(ok ? "Монтажники сохранены" : "Ошибка сохранения монтажников", ok ? "" : "#d32f2f");
      if (ok) document.dispatchEvent(new CustomEvent("order-settings-updated"));
    });
  }

  const settingsSaveAdjustmentsBtn = document.getElementById("settingsSaveAdjustmentsBtn");
  if (settingsSaveAdjustmentsBtn) {
    settingsSaveAdjustmentsBtn.addEventListener("click", async () => {
      const result = await saveBalanceAdjustments();
      if (result?.ok) {
        if (result.historyOk === false) {
          setMessage(
            "Корректировки сохранены, но история для «Все изменения» не записалась. Выполните supabase_settings_history_table.sql в Supabase.",
            "#d32f2f",
          );
        } else {
          setMessage("Корректировки сохранены");
        }
        // Баланс обновляется при открытии его раздела.
      } else {
        setMessage("Ошибка сохранения корректировок", "#d32f2f");
      }
    });
    for (const { inputId } of BALANCE_ADJ_FIELDS) {
      const adjInput = document.getElementById(inputId);
      if (adjInput) {
        const onAdj = () => {
          refreshRublesIntegerInputState(adjInput, adjInput.value, { allowSign: true });
          syncAdjustmentSignButton(adjInput);
          updateAdjustmentsSaveButtonState();
        };
        adjInput.addEventListener("input", onAdj);
        adjInput.addEventListener("change", onAdj);
        adjInput.addEventListener("blur", onAdj);
        syncAdjustmentSignButton(adjInput);
      }
    }
    document.querySelectorAll(".settings-adj-sign-btn").forEach((btn) => {
      if (btn.dataset.adjSignBound === "1") return;
      btn.dataset.adjSignBound = "1";
      let lastActivateAt = 0;
      const activate = (e) => {
        // На iPhone первый тап по кнопке рядом с input часто только закрывает
        // клавиатуру и не даёт click — ловим touchstart/pointerdown сразу.
        if (e.type === "touchstart" || e.type === "pointerdown") {
          if (e.type === "pointerdown" && typeof e.button === "number" && e.button !== 0) return;
          if (e.cancelable) e.preventDefault();
        }
        const now = Date.now();
        if (now - lastActivateAt < 350) return;
        lastActivateAt = now;
        const input = document.getElementById(btn.getAttribute("data-adj-input") || "");
        toggleAdjustmentSign(input);
      };
      btn.addEventListener("touchstart", activate, { passive: false });
      btn.addEventListener("pointerdown", activate);
      btn.addEventListener("click", activate);
    });
  }

  const settingsSection = document.getElementById("section-settings");
  const settingsSaveSalaryParamsBtn = document.getElementById("settingsSaveSalaryParamsBtn");
  const onSalaryParamFieldEvent = (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement)) return;
    const id = t.id || "";
    if (!id.startsWith("settings_salary_")) return;
    if (id.endsWith("_base")) {
      refreshRublesIntegerInputState(t, t.value);
    } else if (id.endsWith("_percent")) {
      refreshPercentInputState(t, t.value);
    } else {
      return;
    }
    updateManagerSalaryParamsSaveButtonState();
  };
  if (settingsSection && settingsSection.dataset.salaryParamsInputBound !== "1") {
    settingsSection.dataset.salaryParamsInputBound = "1";
    settingsSection.addEventListener("input", onSalaryParamFieldEvent);
    settingsSection.addEventListener("change", onSalaryParamFieldEvent);
    settingsSection.addEventListener("keyup", onSalaryParamFieldEvent);
  }
  if (settingsSaveSalaryParamsBtn && settingsSaveSalaryParamsBtn.dataset.salarySaveBound !== "1") {
    settingsSaveSalaryParamsBtn.dataset.salarySaveBound = "1";
    settingsSaveSalaryParamsBtn.addEventListener("click", async () => {
      const ok = await saveManagerSalaryParams();
      setMessage(ok ? "Параметры зарплаты сохранены" : "Ошибка сохранения или неверное значение", ok ? "" : "#d32f2f");
    });
  }
  for (const { baseInputId, percentInputId } of MANAGER_SALARY_PARAM_FIELDS) {
    const baseEl = document.getElementById(baseInputId);
    const percentEl = document.getElementById(percentInputId);
    if (baseEl) {
      baseEl.addEventListener("blur", () => {
        refreshRublesIntegerInputState(baseEl, baseEl.value);
        updateManagerSalaryParamsSaveButtonState();
      });
    }
    if (percentEl) {
      percentEl.addEventListener("blur", () => {
        refreshPercentInputState(percentEl, percentEl.value);
        updateManagerSalaryParamsSaveButtonState();
      });
    }
  }

}
