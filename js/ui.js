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
  cellTooltip,
  ordersTable,
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

  if (ordersTable && cellTooltip) {
    let hideClick, hideKey;
    ordersTable.addEventListener("click", (e) => {
      const td = e.target.closest("td.td-truncate-name, td.td-truncate-address");
      if (!td) return;
      const text = td.getAttribute("title");
      if (!text) return;
      if (hideClick) {
        document.removeEventListener("click", hideClick);
        document.removeEventListener("keydown", hideKey);
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
        document.removeEventListener("click", hideClick);
        document.removeEventListener("keydown", hideKey);
        hideClick = hideKey = null;
      }
      hideClick = hide;
      hideKey = (ev) => { if (ev.key === "Escape") hide(); };
      setTimeout(() => {
        document.addEventListener("click", hideClick);
        document.addEventListener("keydown", hideKey);
      }, 0);
    });
  }

  if (window.location.hash === "#all") {
    switchSection("all");
  }
}