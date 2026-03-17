import {
  form,
  logoutBtn,
  cancelEditBtn,
  cancelEditBtnTop,
  clientSearch,
  selectFilesBtn,
  attachmentsInput,
  closeFilesModal,
  filesModal,
  sectionNavBtns,
  contentSections,
  phoneInput,
  cellTooltip,
  ordersTable,
  message,
} from "./dom.js";

import { logout } from "./auth.js";
import { state } from "./state.js";
import {
  applyClientFilter,
  initStatusFilter,
  resetFormMode,
  submitOrderForm,
  updatePaidField,
  updateRemainingFromCostAndPrepayment,
  updateConditionalRequiredHighlight,
  updateInstallerPaymentAmountFromArea,
  updateInstallerBlockByInstallationDate,
} from "./orders.js";
import { renderSelectedFiles } from "./files.js";
import { saveInstallerRate, updateSettingsSaveButtonState } from "./settings.js";

export function toggleOrderRowHighlightById(orderId) {
  if (!ordersTable || orderId == null) return;
  const tbody = ordersTable.querySelector("tbody");
  if (!tbody) return;
  const idStr = String(orderId);
  const tr = tbody.querySelector(`td.td-order-id[data-order-id="${CSS.escape(idStr)}"]`)?.closest("tr");
  if (!tr) return;
  const wasHighlighted = tr.classList.contains("row-highlighted");
  tbody.querySelectorAll("tr.row-highlighted").forEach((row) => row.classList.remove("row-highlighted"));
  if (!wasHighlighted) tr.classList.add("row-highlighted");
}

function switchSection(sectionId) {
  if (!sectionId || !sectionNavBtns.length || !contentSections.length) return;
  sectionNavBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.section === sectionId);
  });
  contentSections.forEach((section) => {
    section.classList.toggle("active", section.id === "section-" + sectionId);
  });
}

function formatPhoneValue(digits) {
  digits = digits.replace(/\D/g, "").slice(0, 11);
  if (digits.length === 0) return "";
  const first = digits[0];
  if (first !== "8" && first !== "7") return digits;
  const prefix = first === "7" ? "+7-" : "8-";
  const rest = digits.slice(1);
  if (rest.length === 0) return first === "7" ? "+7" : "8";
  let s = prefix + rest.slice(0, 3);
  if (rest.length <= 3) return s;
  s += "-" + rest.slice(3, 6);
  if (rest.length <= 6) return s;
  s += "-" + rest.slice(6, 8);
  if (rest.length <= 8) return s;
  s += "-" + rest.slice(8, 10);
  return s;
}

export function validatePhone() {
  if (!phoneInput) return;
  const raw = (phoneInput.value || "").trim();
  if (raw === "") {
    phoneInput.classList.remove("phone-invalid");
    return;
  }
  const digits = raw.replace(/\D/g, "");
  const valid = digits.length === 11 && (digits[0] === "8" || digits[0] === "7");
  phoneInput.classList.toggle("phone-invalid", !valid);
}

function onPhoneInput() {
  if (!phoneInput) return;
  const prev = phoneInput.value;
  const digits = prev.replace(/\D/g, "");
  const digitsBeforeCaret = (prev.slice(0, phoneInput.selectionStart).match(/\d/g) || []).length;
  const formatted = formatPhoneValue(digits);
  if (formatted !== prev) {
    phoneInput.value = formatted;
    let pos = 0;
    let d = 0;
    for (let i = 0; i < formatted.length && d < digitsBeforeCaret; i++) {
      if (/\d/.test(formatted[i])) d++;
      pos = i + 1;
    }
    phoneInput.setSelectionRange(pos, pos);
  }
  validatePhone();
}

export function bindUIEvents() {
  sectionNavBtns.forEach((btn) => {
    btn.addEventListener("click", () => switchSection(btn.dataset.section));
  });

  if (phoneInput) {
    phoneInput.addEventListener("input", onPhoneInput);
    phoneInput.addEventListener("blur", validatePhone);
  }

  const clientInput = document.getElementById("client");
  if (clientInput) {
    clientInput.addEventListener("input", () => clientInput.classList.remove("client-invalid"));
  }

  const paymentStatusEl = document.getElementById("payment_status");
  if (paymentStatusEl) {
    paymentStatusEl.addEventListener("change", () => paymentStatusEl.classList.remove("payment-status-invalid"));
  }

  if (form) {
    form.addEventListener("submit", submitOrderForm);
  }

  ["amount", "prepayment", "remaining_amount"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", () => {
        if (id === "amount" || id === "prepayment") updateRemainingFromCostAndPrepayment();
        updateConditionalRequiredHighlight();
      });
    }
  });
  ["prepayment_to", "remaining_to", "delivery", "delivery_date"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("change", () => {
        if (id === "remaining_to") updatePaidField();
        updateConditionalRequiredHighlight();
      });
      if (id === "remaining_to") el.addEventListener("input", updatePaidField);
    }
  });
  const deliveryDateEl = document.getElementById("delivery_date");
  if (deliveryDateEl) deliveryDateEl.addEventListener("input", updateConditionalRequiredHighlight);

  const installationCb = document.getElementById("installation");
  const installationDateWrap = document.getElementById("installationDateWrap");
  const installationDateInput = document.getElementById("installation_date");
  if (installationCb && installationDateWrap) {
    installationCb.addEventListener("change", () => {
      installationDateWrap.style.display = installationCb.checked ? "" : "none";
      if (!installationCb.checked && installationDateInput) installationDateInput.value = "";
      updateInstallerBlockByInstallationDate();
    });
  }
  if (installationDateInput) {
    installationDateInput.addEventListener("input", updateInstallerBlockByInstallationDate);
    installationDateInput.addEventListener("change", updateInstallerBlockByInstallationDate);
  }

  const revealsCb = document.getElementById("reveals");
  const revealsDateWrap = document.getElementById("revealsDateWrap");
  const revealsDateInput = document.getElementById("reveals_date");
  if (revealsCb && revealsDateWrap) {
    revealsCb.addEventListener("change", () => {
      revealsDateWrap.style.display = revealsCb.checked ? "" : "none";
      if (!revealsCb.checked && revealsDateInput) revealsDateInput.value = "";
    });
  }

  const installerCalcBtn = document.getElementById("installer_calc_btn");
  if (installerCalcBtn) installerCalcBtn.addEventListener("click", updateInstallerPaymentAmountFromArea);
  const installerAmountEl = document.getElementById("installer_payment_amount");
  if (installerAmountEl) {
    installerAmountEl.addEventListener("input", updateInstallerBlockByInstallationDate);
    installerAmountEl.addEventListener("change", updateInstallerBlockByInstallationDate);
  }

  updatePaidField();
  updateConditionalRequiredHighlight();
  updateInstallerBlockByInstallationDate();

  const settingsSaveInstallerRateBtn = document.getElementById("settingsSaveInstallerRateBtn");
  const settingsInstallerRateInput = document.getElementById("settings_installer_rate_per_m2");
  if (settingsSaveInstallerRateBtn && settingsInstallerRateInput) {
    settingsSaveInstallerRateBtn.addEventListener("click", async () => {
      const ok = await saveInstallerRate(settingsInstallerRateInput.value);
      if (message) {
        message.textContent = ok ? "Сохранено" : "Ошибка сохранения или неверное значение";
        message.style.color = ok ? "" : "#d32f2f";
      }
    });
    settingsInstallerRateInput.addEventListener("input", updateSettingsSaveButtonState);
    settingsInstallerRateInput.addEventListener("change", updateSettingsSaveButtonState);
  }

  if (clientSearch) {
    clientSearch.addEventListener("input", applyClientFilter);
  }

  initStatusFilter();

  if (selectFilesBtn) {
    selectFilesBtn.addEventListener("click", () => {
      attachmentsInput.click();
    });
  }

  if (attachmentsInput) {
    attachmentsInput.addEventListener("change", renderSelectedFiles);
  }

  if (closeFilesModal) {
    closeFilesModal.addEventListener("click", () => {
      filesModal.style.display = "none";
    });
  }

  if (filesModal) {
    filesModal.addEventListener("click", (e) => {
      if (e.target === filesModal) {
        filesModal.style.display = "none";
      }
    });
  }

  const onCancelEdit = () => {
    resetFormMode();
    switchSection("all");
  };
  if (cancelEditBtn) cancelEditBtn.addEventListener("click", onCancelEdit);
  if (cancelEditBtnTop) cancelEditBtnTop.addEventListener("click", onCancelEdit);

  if (logoutBtn) {
    logoutBtn.addEventListener("click", logout);
  }

  let tooltipHideClick = null;
  let tooltipHideKey = null;

  function showCellTooltip(td) {
    if (!cellTooltip || !td) return;
    if (td.scrollWidth <= td.clientWidth) return;
    const raw = td.getAttribute("data-fulltext") || td.getAttribute("title");
    if (!raw) return;
    const decodeEl = document.createElement("div");
    decodeEl.innerHTML = raw;
    const text = decodeEl.textContent || raw;
    if (tooltipHideClick) {
      document.removeEventListener("click", tooltipHideClick);
      document.removeEventListener("touchend", tooltipHideClick);
      document.removeEventListener("keydown", tooltipHideKey);
    }
    cellTooltip.textContent = text;
    cellTooltip.classList.add("visible");
    cellTooltip.setAttribute("aria-hidden", "false");
    const rect = td.getBoundingClientRect();
    cellTooltip.style.left = Math.min(rect.left, window.innerWidth - 330) + "px";
    cellTooltip.style.top = rect.top - 8 + "px";
    cellTooltip.style.transform = "translateY(-100%)";
    function hide() {
      cellTooltip.classList.remove("visible");
      cellTooltip.setAttribute("aria-hidden", "true");
      document.removeEventListener("click", tooltipHideClick);
      document.removeEventListener("touchend", tooltipHideClick);
      document.removeEventListener("keydown", tooltipHideKey);
      tooltipHideClick = tooltipHideKey = null;
    }
    tooltipHideClick = hide;
    tooltipHideKey = (ev) => { if (ev.key === "Escape") hide(); };
    setTimeout(() => {
      document.addEventListener("click", tooltipHideClick);
      document.addEventListener("touchend", tooltipHideClick);
      document.addEventListener("keydown", tooltipHideKey);
    }, 150);
  }

  if (ordersTable && cellTooltip) {
    const toggleRowHighlight = (tr) => {
      if (!tr) return;
      const tbody = ordersTable.querySelector("tbody");
      if (!tbody) return;
      const wasHighlighted = tr.classList.contains("row-highlighted");
      tbody.querySelectorAll("tr.row-highlighted").forEach((row) => row.classList.remove("row-highlighted"));
      if (!wasHighlighted) tr.classList.add("row-highlighted");
    };

    const handleRowClick = (e) => {
      if (cellTooltip.classList.contains("visible") && tooltipHideClick) {
        tooltipHideClick();
        return;
      }

      const tr = e.target.closest("tbody tr");

      const idTd = e.target.closest("td.td-order-id");
      if (idTd) {
        const raw = idTd.getAttribute("data-order-id") || "";
        const orderId = raw ? Number(raw) : NaN;
        if (!Number.isNaN(orderId) && typeof window.editOrder === "function") {
          window.editOrder(orderId);
        }
        return;
      }

      // Тап/клик по интерактивным элементам строки не должен включать выделение
      if (e.target.closest("button, a, .btn-icon, input, select, textarea, label")) return;

      if (e.target.closest("a.tel-link")) return;

      const td = e.target.closest("td.td-truncate-name, td.td-truncate-address, td.td-truncate-description");
      if (td) {
        showCellTooltip(td);
        return;
      }

      if (tr) {
        toggleRowHighlight(tr);
      }
    };

    ordersTable.addEventListener("click", (e) => {
      handleRowClick(e);
    });
  }

  if (window.location.hash === "#all") {
    switchSection("all");
  }
}