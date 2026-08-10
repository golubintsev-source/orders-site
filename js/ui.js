import {
  form,
  logoutBtn,
  cancelEditBtn,
  cancelEditBtnTop,
  clientSearch,
  selectFilesBtn,
  pasteClipboardImageBtn,
  clipboardPasteHint,
  attachmentsInput,
  closeFilesModal,
  filesModal,
  phoneInput,
  cellTooltip,
  ordersTable,
  setMessage,
} from "./dom.js";

import {
  switchSection,
  initSectionNavDropdown,
  closeSectionNavDropdown,
  closeOrdersSearchPanel,
  syncOrdersSearchIconAccent,
  syncIosFormControlLocks,
} from "./section-nav.js";

import { logout } from "./auth.js";
import { state } from "./state.js";
import { logPhoneCall } from "./access-log.js";
import {
  applyClientFilter,
  initStatusFilter,
  initOrderTypeFilter,
  initPaidFilter,
  initOrderDateFilter,
  resetFormMode,
  leaveOrderFormOnCancel,
  leaveOrderFormToSection,
  isOrderFormSessionActive,
  submitOrderForm,
  updatePaidField,
  updateRemainingFromCostAndPrepayment,
  updateConditionalRequiredHighlight,
  updateOrderFormDateFieldHighlights,
  updateInstallerPaymentAmountFromArea,
  updateInstallerBlockByInstallationDate,
  formatOrderFormNumericInputById,
  bindOrderFormDdMmYyyyInputs,
  canShowEditButtonForOrder,
  setLockEditForUserLite,
  RUBLE_INTEGER_ORDER_FIELD_IDS,
  buildOrderRowFullTooltipHtml,
} from "./orders.js";
import { mergeNewAttachmentsOnChange, pasteImageFromClipboardIntoAttachments } from "./files.js";
import { initClientAutocomplete, initAddressAutocomplete } from "./clientAutocomplete.js";
import {
  saveInstallerRate,
  saveDriverName,
  saveBalanceAdjustments,
  updateSettingsSaveButtonState,
  updateDriverSaveButtonState,
  updateAdjustmentsSaveButtonState,
  BALANCE_ADJ_FIELDS,
} from "./settings.js";
import { loadBalance } from "./balance.js";
import { canMutateOrders, isOrderEditLockedForUserLite, isUserLite, isUserShop } from "./roles.js";
import { formatPhoneValue, isValidOrderPhone, refreshRublesIntegerInputState } from "./format.js";

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

const ORDER_ID_MENU_ICONS = {
  view: `<svg class="order-id-actions-menu-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  edit: `<svg class="order-id-actions-menu-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  tasks: `<svg class="order-id-actions-menu-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
  history: `<svg class="order-id-actions-menu-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
  files: `<svg class="order-id-actions-menu-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`,
  phone: `<svg class="order-id-actions-menu-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
};

let orderIdMenuDocClose = null;
let orderIdMenuEsc = null;

export function closeOrderIdActionsMenu() {
  const menu = document.getElementById("orderIdActionsMenu");
  if (!menu) return;
  menu.hidden = true;
  menu.innerHTML = "";
  delete menu.dataset.currentOrderId;
  menu.style.top = "";
  menu.style.left = "";
  menu.style.visibility = "";
  if (orderIdMenuDocClose) {
    document.removeEventListener("click", orderIdMenuDocClose);
    orderIdMenuDocClose = null;
  }
  if (orderIdMenuEsc) {
    document.removeEventListener("keydown", orderIdMenuEsc);
    orderIdMenuEsc = null;
  }
}

export function openOrderIdActionsMenu(idTd) {
  const menu = document.getElementById("orderIdActionsMenu");
  if (!menu || !idTd) return;

  const raw = idTd.getAttribute("data-order-id") || "";
  const orderId = raw ? Number(raw) : NaN;
  if (Number.isNaN(orderId)) return;

  if (!menu.hidden && menu.dataset.currentOrderId === String(orderId)) {
    closeOrderIdActionsMenu();
    return;
  }

  closeOrderIdActionsMenu();

  const phoneRaw = (idTd.getAttribute("data-phone") || "").trim();
  const telHref = phoneRaw ? `tel:${phoneRaw.replace(/[^\d+]/g, "")}` : "";
  const historyHref = `history.html?order_id=${encodeURIComponent(orderId)}`;

  const filesCount = Math.max(0, parseInt(String(idTd.getAttribute("data-files-count") || "0"), 10) || 0);

  const { view, edit, tasks, history, files, phone } = ORDER_ID_MENU_ICONS;

  const filesIconBlock =
    filesCount > 0
      ? `<span class="order-id-actions-menu-icon-wrap">${files}<span class="order-id-actions-menu-files-badge">${filesCount}</span></span>`
      : `<span class="order-id-actions-menu-icon-wrap">${files}</span>`;

  const filesItemClass =
    filesCount > 0
      ? "order-id-actions-menu-item"
      : "order-id-actions-menu-item order-id-actions-menu-item--no-files";

  const callBlock = phoneRaw
    ? `<a href="${telHref}" class="order-id-actions-menu-item order-id-actions-menu-item--call" role="menuitem">${phone}<span>Позвонить</span></a>`
    : `<div class="order-id-actions-menu-item order-id-actions-menu-item--disabled" role="menuitem" aria-disabled="true">${phone}<span>Позвонить</span></div>`;

  const orderRow = state.allOrders.find((o) => Number(o.id) === orderId);
  const viewItem = `<button type="button" class="order-id-actions-menu-item" role="menuitem" data-action="view">${view}<span>Посмотреть</span></button>`;
  const editItem = orderRow && canShowEditButtonForOrder(orderRow)
    ? `<button type="button" class="order-id-actions-menu-item" role="menuitem" data-action="edit">${edit}<span>Редактировать</span></button>`
    : "";

  const tasksHighlight =
    orderRow &&
    (orderRow.tasks_highlight === true ||
      orderRow.tasks_highlight === 1 ||
      orderRow.tasks_highlight === "1");
  const tasksItemClass = tasksHighlight
    ? "order-id-actions-menu-item order-id-actions-menu-item--tasks-highlight"
    : "order-id-actions-menu-item";
  const tasksItem = `<button type="button" class="${tasksItemClass}" role="menuitem" data-action="tasks">${tasks}<span>Задачи</span></button>`;

  const lockChecked = orderRow && isOrderEditLockedForUserLite(orderRow);
  const lockBlock =
    orderRow && !isUserLite() && !isUserShop() && canMutateOrders()
      ? `<label class="order-id-actions-menu-lock" title="Закрыть редактирование заказа для роли user_lite">
    <input type="checkbox" data-action="toggle-lock-edit-user-lite" ${lockChecked ? "checked" : ""} />
    <span>Закрыть редактирование</span>
  </label>`
      : "";

  menu.innerHTML = `
    ${viewItem}
    ${editItem}
    ${tasksItem}
    <a href="${historyHref}" class="order-id-actions-menu-item" role="menuitem">${history}<span>Изменения</span></a>
    <button type="button" class="${filesItemClass}" role="menuitem" data-action="files">${filesIconBlock}<span>Файлы</span></button>
    ${callBlock}
    ${lockBlock}
  `;

  menu.dataset.currentOrderId = String(orderId);
  menu.hidden = false;

  const rect = idTd.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.zIndex = "1100";
  /* Сначала под номером; если не влезает в viewport — над ним (как у тултипов/попапов). */
  menu.style.visibility = "hidden";
  menu.style.top = "0";
  menu.style.left = "0";
  requestAnimationFrame(() => {
    const margin = 8;
    const gap = 4;
    const mw = menu.offsetWidth || 240;
    const mh = menu.offsetHeight || 0;
    let left = rect.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - mw - margin));
    let top = rect.bottom + gap;
    if (top + mh > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - mh - gap);
    }
    menu.style.top = `${Math.round(top)}px`;
    menu.style.left = `${Math.round(left)}px`;
    menu.style.visibility = "visible";
  });

  orderIdMenuDocClose = () => closeOrderIdActionsMenu();
  orderIdMenuEsc = (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      closeOrderIdActionsMenu();
    }
  };
  setTimeout(() => {
    document.addEventListener("click", orderIdMenuDocClose);
    document.addEventListener("keydown", orderIdMenuEsc);
  }, 0);
}

export function validatePhone() {
  if (!phoneInput) return;
  const raw = (phoneInput.value || "").trim();
  if (raw === "") {
    phoneInput.classList.remove("phone-invalid");
    return;
  }
  phoneInput.classList.toggle("phone-invalid", !isValidOrderPhone(raw));
}

function onPhoneInput() {
  if (!phoneInput) return;
  const prev = phoneInput.value;
  const digitsBeforeCaret = (prev.slice(0, phoneInput.selectionStart).match(/\d/g) || []).length;
  const formatted = formatPhoneValue(prev);
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
  initSectionNavDropdown({
    onSectionItemSelect: (id) => {
      // Уход с формы изменения/просмотра через меню — иначе restore вернёт на тот же заказ.
      if (id !== "new" && isOrderFormSessionActive()) {
        leaveOrderFormToSection(id);
        return;
      }
      if (id === "new" && state.viewingOrderId != null) {
        resetFormMode();
      }
      switchSection(id);
    },
  });

  bindOrderFormDdMmYyyyInputs();

  if (phoneInput) {
    phoneInput.addEventListener("input", onPhoneInput);
    phoneInput.addEventListener("blur", validatePhone);
  }

  const clientInput = document.getElementById("client");
  if (clientInput) {
    clientInput.addEventListener("input", () => clientInput.classList.remove("client-invalid"));
  }
  const addressInput = document.getElementById("address");
  if (addressInput) {
    addressInput.addEventListener("input", () => addressInput.classList.remove("address-invalid"));
  }
  initClientAutocomplete();
  initAddressAutocomplete();

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
        if (id === "remaining_amount") updatePaidField();
        updateConditionalRequiredHighlight();
      });
    }
  });

  // Форматирование всех числовых полей на странице "Новый" с пробелами тысяч
  [
    "amount",
    "prepayment",
    "remaining_amount",
    "area_m2",
    "mosquito_nets",
    "construction_count",
    "installer_rate_per_m2",
    "installer_payment_amount",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("blur", () => {
      formatOrderFormNumericInputById(id);

      if (id === "amount" || id === "prepayment") updateRemainingFromCostAndPrepayment();
      if (id === "area_m2" || id === "installer_rate_per_m2") updateInstallerPaymentAmountFromArea();
      if (id === "installer_payment_amount") updateInstallerBlockByInstallationDate();
      if (id === "amount" || id === "prepayment" || id === "remaining_amount") updateConditionalRequiredHighlight();
      if (id === "amount" || id === "prepayment" || id === "remaining_amount") updatePaidField();
    });
  });

  RUBLE_INTEGER_ORDER_FIELD_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => refreshRublesIntegerInputState(el, el.value));
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
      updateOrderFormDateFieldHighlights(false);
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
      updateOrderFormDateFieldHighlights(false);
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

  const settingsSaveAdjustmentsBtn = document.getElementById("settingsSaveAdjustmentsBtn");
  if (settingsSaveAdjustmentsBtn) {
    settingsSaveAdjustmentsBtn.addEventListener("click", async () => {
      const ok = await saveBalanceAdjustments();
      setMessage(ok ? "Корректировки сохранены" : "Ошибка сохранения корректировок", ok ? "" : "#d32f2f");
      if (ok) await loadBalance();
    });
    for (const { inputId } of BALANCE_ADJ_FIELDS) {
      const adjInput = document.getElementById(inputId);
      if (adjInput) {
        const onAdj = () => {
          refreshRublesIntegerInputState(adjInput, adjInput.value, { allowSign: true });
          updateAdjustmentsSaveButtonState();
        };
        adjInput.addEventListener("input", onAdj);
        adjInput.addEventListener("change", onAdj);
        adjInput.addEventListener("blur", onAdj);
      }
    }
  }

  const ordersSearchOpenBtn = document.getElementById("ordersSearchOpenBtn");
  const ordersSearchPopupInput = document.getElementById("ordersSearchPopupInput");
  const ordersSearchFindBtn = document.getElementById("ordersSearchFindBtn");
  const ordersSearchCloseBtn = document.getElementById("ordersSearchCloseBtn");
  const ordersSearchPanel = document.getElementById("ordersSearchDropdownPanel");

  function openOrdersSearchDropdown() {
    if (!ordersSearchOpenBtn || !ordersSearchPanel) return;
    closeSectionNavDropdown();
    if (ordersSearchPopupInput && clientSearch) {
      ordersSearchPopupInput.value = clientSearch.value || "";
    }
    ordersSearchPanel.hidden = false;
    ordersSearchOpenBtn.setAttribute("aria-expanded", "true");
    ordersSearchOpenBtn.classList.add("section-nav-search-btn--open");
    syncIosFormControlLocks();
    queueMicrotask(() => ordersSearchPopupInput?.focus());
  }

  function toggleOrdersSearchDropdown() {
    if (!ordersSearchPanel || !ordersSearchOpenBtn) return;
    if (ordersSearchPanel.hidden) {
      openOrdersSearchDropdown();
    } else {
      closeOrdersSearchPanel();
    }
  }

  function applyOrdersSearchFromDropdown() {
    if (clientSearch && ordersSearchPopupInput) {
      clientSearch.value = ordersSearchPopupInput.value.trim();
    }
    closeOrdersSearchPanel();
    applyClientFilter();
    syncOrdersSearchIconAccent();
    switchSection("all");
  }

  /** Отмена: очистить поле и сбросить фильтр, закрыть панель. */
  function cancelOrdersSearchFromDropdown() {
    if (ordersSearchPopupInput) ordersSearchPopupInput.value = "";
    if (clientSearch) clientSearch.value = "";
    closeOrdersSearchPanel();
    applyClientFilter();
    syncOrdersSearchIconAccent();
  }

  if (ordersSearchOpenBtn) {
    ordersSearchOpenBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (ordersSearchOpenBtn.dataset.navMode === "orders") {
        if (isOrderFormSessionActive()) {
          leaveOrderFormToSection("all");
        } else {
          switchSection("all");
        }
        return;
      }
      toggleOrdersSearchDropdown();
    });
  }
  if (ordersSearchFindBtn) {
    ordersSearchFindBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      applyOrdersSearchFromDropdown();
    });
  }
  if (ordersSearchCloseBtn) {
    ordersSearchCloseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      cancelOrdersSearchFromDropdown();
    });
  }
  if (ordersSearchPopupInput) {
    ordersSearchPopupInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        applyOrdersSearchFromDropdown();
      }
    });
  }

  initStatusFilter();
  initOrderTypeFilter();
  initPaidFilter();
  initOrderDateFilter();

  if (selectFilesBtn) {
    selectFilesBtn.addEventListener("click", () => {
      if (clipboardPasteHint) clipboardPasteHint.textContent = "";
      attachmentsInput.click();
    });
  }

  if (pasteClipboardImageBtn) {
    pasteClipboardImageBtn.addEventListener("click", () => {
      if (clipboardPasteHint) clipboardPasteHint.textContent = "";
      void (async () => {
        const result = await pasteImageFromClipboardIntoAttachments();
        if (result === "empty" && clipboardPasteHint) {
          clipboardPasteHint.textContent = "Буфер пуст";
        }
      })();
    });
  }

  if (attachmentsInput) {
    attachmentsInput.addEventListener("change", () => {
      void mergeNewAttachmentsOnChange();
    });
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
    leaveOrderFormOnCancel();
  };
  if (cancelEditBtn) cancelEditBtn.addEventListener("click", onCancelEdit);
  if (cancelEditBtnTop) cancelEditBtnTop.addEventListener("click", onCancelEdit);

  if (logoutBtn) {
    logoutBtn.addEventListener("click", logout);
  }

  const backToOrdersBtn = document.getElementById("backToOrdersBtn");
  if (backToOrdersBtn) {
    backToOrdersBtn.addEventListener("click", () => {
      if (isOrderFormSessionActive()) {
        leaveOrderFormToSection("all");
      } else {
        switchSection("all");
      }
    });
  }

  let tooltipHideClick = null;
  let tooltipHideKey = null;

  function decodeDataFulltext(raw) {
    if (!raw) return "";
    const decodeEl = document.createElement("div");
    decodeEl.innerHTML = raw;
    return decodeEl.textContent || raw;
  }

  /** Копирование полного адреса в буфер (клик по адресу в «Доставке»). */
  async function copyTextToClipboard(text) {
    const value = String(text ?? "").trim();
    if (!value) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {
      /* fall through */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }

  function showRouteSheetDeliveryAddressTooltipAndCopy(anchorEl, text) {
    const full = String(text ?? "").trim();
    if (!full) return;
    showFloatingCellTooltip(anchorEl, full);
    void copyTextToClipboard(full);
  }

  function showFloatingCellTooltip(anchorEl, text, opts) {
    opts = opts || {};
    const useHtml = Boolean(opts.html);
    if (!cellTooltip || !anchorEl || (!text && !useHtml)) return;
    if (tooltipHideClick) {
      document.removeEventListener("click", tooltipHideClick);
      document.removeEventListener("touchend", tooltipHideClick);
      document.removeEventListener("keydown", tooltipHideKey);
      tooltipHideClick = tooltipHideKey = null;
    }
    cellTooltip.classList.remove("cell-tooltip--order-row-wide");
    if (opts.tooltipClass) {
      opts.tooltipClass
        .split(/\s+/)
        .filter(Boolean)
        .forEach((c) => cellTooltip.classList.add(c));
    }
    if (useHtml) {
      cellTooltip.innerHTML = text;
    } else {
      cellTooltip.textContent = text;
    }
    cellTooltip.classList.add("visible");
    cellTooltip.setAttribute("aria-hidden", "false");
    /*
     * Позиция как у попапа комментария в «Расчётах»: сначала под якорем, иначе над ним; не уезжает за край экрана.
     * Раньше: translateY(-100%) от верха ячейки — на iPhone подсказка часто оказывалась за пределами viewport.
     */
    cellTooltip.style.transform = "none";
    cellTooltip.style.visibility = "hidden";
    cellTooltip.style.left = "0";
    cellTooltip.style.top = "0";
    cellTooltip.style.zIndex = "10050";

    function layoutTooltip() {
      const rect = anchorEl.getBoundingClientRect();
      const margin = 8;
      const tw = cellTooltip.offsetWidth;
      const th = cellTooltip.offsetHeight;
      let left = rect.left;
      if (left + tw > window.innerWidth - margin) left = window.innerWidth - margin - tw;
      if (left < margin) left = margin;
      let top = rect.bottom + margin;
      if (top + th > window.innerHeight - margin) {
        top = Math.max(margin, rect.top - th - margin);
      }
      cellTooltip.style.left = `${Math.round(left)}px`;
      cellTooltip.style.top = `${Math.round(top)}px`;
      cellTooltip.style.visibility = "visible";
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(layoutTooltip);
    });

    function hide() {
      cellTooltip.classList.remove("visible");
      cellTooltip.setAttribute("aria-hidden", "true");
      cellTooltip.textContent = "";
      cellTooltip.innerHTML = "";
      cellTooltip.classList.remove("cell-tooltip--order-row-wide");
      if (opts.tooltipClass) {
        opts.tooltipClass
          .split(/\s+/)
          .filter(Boolean)
          .forEach((c) => cellTooltip.classList.remove(c));
      }
      cellTooltip.style.visibility = "";
      cellTooltip.style.left = "";
      cellTooltip.style.top = "";
      cellTooltip.style.transform = "";
      cellTooltip.style.zIndex = "";
      document.removeEventListener("click", tooltipHideClick);
      document.removeEventListener("touchend", tooltipHideClick);
      document.removeEventListener("keydown", tooltipHideKey);
      tooltipHideClick = tooltipHideKey = null;
    }
    tooltipHideClick = hide;
    tooltipHideKey = (ev) => {
      if (ev.key === "Escape") hide();
    };
    /* Как в calculations.js: слушатель «снаружи» после текущего клика, без задержки 150ms. */
    setTimeout(() => {
      document.addEventListener("click", tooltipHideClick);
      document.addEventListener("touchend", tooltipHideClick);
      document.addEventListener("keydown", tooltipHideKey);
    }, 0);
  }

  /** Чип внутри ячейки может не отражать обрезку (inline-block в колонке таблицы); дублируем проверку по `td`. */
  function isOrdersTableCellTruncated(td) {
    if (!td) return false;
    const chip = td.querySelector(".status-value");
    if (chip && chip.scrollWidth > chip.clientWidth + 0.5) return true;
    return td.scrollWidth > td.clientWidth + 0.5;
  }

  /**
   * Геометрическая обрезка (scrollWidth) обычно достаточна; в `#routeSheetTableDelivery` у `td.td-order-address`
   * она часто даёт ложный «не обрезано» при видимом «…» (текст в DOM полный, как и `data-fulltext`).
   * Тогда по клику показываем подсказку, если `data-fulltext` непустой.
   */
  function shouldShowOrderCellFulltextTooltip(td) {
    if (!td) return false;
    if (isOrdersTableCellTruncated(td)) return true;
    if (td.closest("#routeSheetTableDelivery") && td.matches("td.td-order-address")) {
      const raw = td.getAttribute("data-fulltext");
      return Boolean(raw && String(decodeDataFulltext(raw)).trim());
    }
    return false;
  }

  function showCellTooltip(td) {
    if (!cellTooltip || !td) return;
    if (!shouldShowOrderCellFulltextTooltip(td)) return;
    const raw = td.getAttribute("data-fulltext") || td.getAttribute("title");
    if (!raw) return;
    const text = decodeDataFulltext(raw);
    showFloatingCellTooltip(td, text);
  }

  function showRouteSheetDeliveryClampTooltip(innerEl) {
    if (!cellTooltip || !innerEl) return;
    const raw = innerEl.getAttribute("data-fulltext");
    if (!raw || !String(raw).trim()) return;
    const text = decodeDataFulltext(raw);
    if (!String(text).trim()) return;
    showFloatingCellTooltip(innerEl, text);
  }

  if (ordersTable) {
    const toggleRowHighlight = (tr) => {
      if (!tr) return;
      const tbody = ordersTable.querySelector("tbody");
      if (!tbody) return;
      const wasHighlighted = tr.classList.contains("row-highlighted");
      tbody.querySelectorAll("tr.row-highlighted").forEach((row) => row.classList.remove("row-highlighted"));
      if (!wasHighlighted) tr.classList.add("row-highlighted");
    };

    const handleRowClick = (e) => {
      const tr = e.target.closest("tbody tr");

      const idTd = e.target.closest("td.td-order-id");
      if (idTd) {
        e.stopPropagation();
        e.preventDefault();
        openOrderIdActionsMenu(idTd);
        return;
      }

      const dateTd = e.target.closest("td.td-order-date");
      if (dateTd && tr && tr.contains(dateTd)) {
        const idCell = tr.querySelector("td.td-order-id[data-order-id]");
        const rawId = idCell?.getAttribute("data-order-id");
        const orderId = rawId != null && rawId !== "" ? Number(rawId) : NaN;
        const orderRow =
          Number.isFinite(orderId) && state.allOrders.find((o) => Number(o.id) === orderId);
        if (orderRow) {
          e.preventDefault();
          e.stopPropagation();
          const html = buildOrderRowFullTooltipHtml(orderRow);
          showFloatingCellTooltip(dateTd, html, {
            html: true,
            tooltipClass: "cell-tooltip--order-row-wide",
          });
          return;
        }
      }

      const tdTip = e.target.closest(
        "td.td-order-client, td.td-order-address, td.td-order-description, td.td-order-status"
      );
      if (tdTip && tdTip.getAttribute("data-fulltext") && shouldShowOrderCellFulltextTooltip(tdTip)) {
        showCellTooltip(tdTip);
        return;
      }

      if (cellTooltip && cellTooltip.classList.contains("visible") && tooltipHideClick) {
        tooltipHideClick();
        return;
      }

      if (e.target.closest("button, a, .btn-icon, input, select, textarea, label")) return;

      if (e.target.closest("a.tel-link")) return;

      if (tr) {
        toggleRowHighlight(tr);
      }
    };

    ordersTable.addEventListener("click", (e) => {
      handleRowClick(e);
    });
  }

  const routeSheetDeliveryTable = document.getElementById("routeSheetTableDelivery");
  if (routeSheetDeliveryTable) {
    function routeSheetDeliveryClampInnerFromEvent(e) {
      const raw = e.target;
      const el = raw && raw.nodeType === Node.TEXT_NODE ? raw.parentElement : raw;
      if (!el || typeof el.closest !== "function") return null;
      if (el.closest("button, a, .btn-icon, input, select, textarea, label")) return null;
      const inner = el.closest(".route-sheet-delivery-clamp-inner[data-fulltext]");
      if (!inner || !routeSheetDeliveryTable.contains(inner)) return null;
      if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return null;
      return inner;
    }

    function onRouteSheetDeliveryClampShow(e) {
      const inner = routeSheetDeliveryClampInnerFromEvent(e);
      if (!inner) return;
      e.preventDefault();
      e.stopPropagation();
      const inAddress = Boolean(inner.closest("td.td-order-address"));
      if (inAddress) {
        const raw = inner.getAttribute("data-fulltext");
        const text = decodeDataFulltext(raw);
        if (String(text).trim()) {
          showRouteSheetDeliveryAddressTooltipAndCopy(inner, text);
          return;
        }
      }
      showRouteSheetDeliveryClampTooltip(inner);
    }

    function onRouteSheetDeliveryTablePointer(e) {
      if (e.type !== "click") return;
      const addrInner = e.target.closest(
        "#routeSheetTableDelivery td.td-order-address .route-sheet-delivery-clamp-inner[data-fulltext]",
      );
      if (addrInner && routeSheetDeliveryTable.contains(addrInner)) {
        if (e.target.closest("button, a, .btn-icon, input, select, textarea, label")) return;
        const raw = addrInner.getAttribute("data-fulltext");
        if (!raw) return;
        const text = decodeDataFulltext(raw);
        if (!String(text).trim()) return;
        e.preventDefault();
        e.stopPropagation();
        showRouteSheetDeliveryAddressTooltipAndCopy(addrInner, text);
        return;
      }
      const addrTd = e.target.closest("td.td-order-address");
      if (
        addrTd &&
        routeSheetDeliveryTable.contains(addrTd) &&
        addrTd.getAttribute("data-fulltext") &&
        shouldShowOrderCellFulltextTooltip(addrTd)
      ) {
        e.preventDefault();
        e.stopPropagation();
        const raw = addrTd.getAttribute("data-fulltext") || addrTd.getAttribute("title");
        const text = decodeDataFulltext(raw);
        if (String(text).trim()) {
          showRouteSheetDeliveryAddressTooltipAndCopy(addrTd, text);
        }
        return;
      }
      onRouteSheetDeliveryClampShow(e);
    }

    /* Адрес — как в «Заказах» (клик по обрезанному тексту); остальное — clamp-inner. touchend давал двойной цикл с click на iOS. */
    routeSheetDeliveryTable.addEventListener("click", onRouteSheetDeliveryTablePointer);
    routeSheetDeliveryTable.addEventListener("keydown", onRouteSheetDeliveryClampShow);
  }

  const orderIdActionsMenu = document.getElementById("orderIdActionsMenu");
  if (orderIdActionsMenu) {
    orderIdActionsMenu.addEventListener("change", (e) => {
      const t = e.target;
      if (t?.matches?.('input[data-action="toggle-lock-edit-user-lite"]')) {
        e.stopPropagation();
        const id = Number(orderIdActionsMenu.dataset.currentOrderId);
        if (Number.isNaN(id)) return;
        void setLockEditForUserLite(id, t.checked);
      }
    });

    orderIdActionsMenu.addEventListener("click", (e) => {
      e.stopPropagation();
      if (e.target.closest("label.order-id-actions-menu-lock")) {
        e.stopPropagation();
      }
      const callLink = e.target.closest("a.order-id-actions-menu-item--call");
      if (callLink) {
        const id = Number(orderIdActionsMenu.dataset.currentOrderId);
        const phone =
          callLink.getAttribute("href")?.replace(/^tel:/i, "") ||
          document.querySelector(`td[data-order-id="${id}"]`)?.getAttribute("data-phone") ||
          "";
        logPhoneCall({
          orderId: Number.isNaN(id) ? null : id,
          phone,
        });
        closeOrderIdActionsMenu();
        return;
      }
      if (e.target.closest("a.order-id-actions-menu-item")) {
        closeOrderIdActionsMenu();
        return;
      }
      const btn = e.target.closest("button[data-action]");
      if (!btn || !orderIdActionsMenu.contains(btn)) return;
      const action = btn.dataset.action;
      const id = Number(orderIdActionsMenu.dataset.currentOrderId);
      if (Number.isNaN(id)) return;
      if (action === "view") {
        closeOrderIdActionsMenu();
        window.viewOrder?.(id);
      } else if (action === "edit") {
        closeOrderIdActionsMenu();
        window.editOrder?.(id);
      } else if (action === "tasks") {
        closeOrderIdActionsMenu();
        state.tasksOrderId = id;
        switchSection("order-tasks");
      } else if (action === "files") {
        closeOrderIdActionsMenu();
        window.openFilesModal?.(id);
      }
    });
  }

  document.addEventListener("orders-table-will-render", closeOrderIdActionsMenu);
}