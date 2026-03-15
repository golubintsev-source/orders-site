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
} from "./dom.js";

import { logout } from "./auth.js";
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

export function bindUIEvents() {
  sectionNavBtns.forEach((btn) => {
    btn.addEventListener("click", () => switchSection(btn.dataset.section));
  });

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
      resetFormMode();
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", logout);
  }
}