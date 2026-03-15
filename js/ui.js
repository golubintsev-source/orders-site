import {
  form,
  loadBtn,
  logoutBtn,
  cancelEditBtn,
  clientSearch,
  selectFilesBtn,
  attachmentsInput,
  closeFilesModal,
  filesModal,
  sectionNavBtns,
  contentSections,
  phoneInput,
} from "./dom.js";

import { logout } from "./auth.js";
import { state } from "./state.js";
import {
  loadOrders,
  applyClientFilter,
  resetFormMode,
  submitOrderForm,
} from "./orders.js";
import { renderSelectedFiles } from "./files.js";

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
  let s = digits[0];
  if (digits.length <= 1) return s;
  s += "-" + digits.slice(1, 4);
  if (digits.length <= 4) return s;
  s += "-" + digits.slice(4, 7);
  if (digits.length <= 7) return s;
  s += "-" + digits.slice(7, 9);
  if (digits.length <= 9) return s;
  s += "-" + digits.slice(9, 11);
  return s;
}

export function validatePhone() {
  if (!phoneInput) return;
  const raw = (phoneInput.value || "").trim();
  const digits = raw.replace(/\D/g, "");
  const valid = raw === "" || (digits.length === 11 && (digits[0] === "8" || digits[0] === "7"));
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

  if (form) {
    form.addEventListener("submit", submitOrderForm);
  }

  if (loadBtn) {
    loadBtn.addEventListener("click", loadOrders);
  }

  if (clientSearch) {
    clientSearch.addEventListener("input", applyClientFilter);
  }

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

  if (cancelEditBtn) {
    cancelEditBtn.addEventListener("click", () => {
      const wasEditing = Boolean(state.editingOrderId);
      resetFormMode();
      if (wasEditing) switchSection("all");
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", logout);
  }

  if (window.location.hash === "#all") {
    switchSection("all");
  }
}