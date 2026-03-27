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
} from "./section-nav.js";

import { logout } from "./auth.js";
import { state } from "./state.js";
import {
  applyClientFilter,
  initStatusFilter,
  initOrderTypeFilter,
  resetFormMode,
  submitOrderForm,
  updatePaidField,
  updateRemainingFromCostAndPrepayment,
  updateConditionalRequiredHighlight,
  updateInstallerPaymentAmountFromArea,
  updateInstallerBlockByInstallationDate,
  formatOrderFormNumericInputById,
  bindOrderFormDdMmYyyyInputs,
  canShowEditButtonForOrder,
  setLockEditForUserLite,
} from "./orders.js";
import { mergeNewAttachmentsOnChange } from "./files.js";
import {
  saveInstallerRate,
  saveBalanceAdjustments,
  updateSettingsSaveButtonState,
  updateAdjustmentsSaveButtonState,
  BALANCE_ADJ_FIELDS,
} from "./settings.js";
import { loadBalance } from "./balance.js";
import { canMutateOrders, isOrderEditLockedForUserLite, isUserLite } from "./roles.js";

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
  if (orderIdMenuDocClose) {
    document.removeEventListener("click", orderIdMenuDocClose);
    orderIdMenuDocClose = null;
  }
  if (orderIdMenuEsc) {
    document.removeEventListener("keydown", orderIdMenuEsc);
    orderIdMenuEsc = null;
  }
}

function openOrderIdActionsMenu(idTd) {
  const menu = document.getElementById("orderIdActionsMenu");
  if (!menu || !idTd) return;

  closeOrderIdActionsMenu();

  const raw = idTd.getAttribute("data-order-id") || "";
  const orderId = raw ? Number(raw) : NaN;
  if (Number.isNaN(orderId)) return;

  const phoneRaw = (idTd.getAttribute("data-phone") || "").trim();
  const telHref = phoneRaw ? `tel:${phoneRaw.replace(/[^\d+]/g, "")}` : "";
  const historyHref = `history.html?order_id=${encodeURIComponent(orderId)}`;

  const filesCount = Math.max(0, parseInt(String(idTd.getAttribute("data-files-count") || "0"), 10) || 0);

  const { edit, tasks, history, files, phone } = ORDER_ID_MENU_ICONS;

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
    orderRow && !isUserLite() && canMutateOrders()
      ? `<label class="order-id-actions-menu-lock" title="Закрыть редактирование заказа для роли user_lite">
    <input type="checkbox" data-action="toggle-lock-edit-user-lite" ${lockChecked ? "checked" : ""} />
    <span>Закрыть редактирование</span>
  </label>`
      : "";

  menu.innerHTML = `
    ${editItem}
    ${tasksItem}
    <a href="${historyHref}" class="order-id-actions-menu-item" role="menuitem">${history}<span>История</span></a>
    <button type="button" class="${filesItemClass}" role="menuitem" data-action="files">${filesIconBlock}<span>Файлы</span></button>
    ${callBlock}
    ${lockBlock}
  `;

  menu.dataset.currentOrderId = String(orderId);
  menu.hidden = false;

  const rect = idTd.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.zIndex = "1100";
  requestAnimationFrame(() => {
    const mw = menu.offsetWidth || 240;
    let left = rect.left;
    left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
    menu.style.top = `${Math.round(rect.bottom + 4)}px`;
    menu.style.left = `${Math.round(left)}px`;
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
  initSectionNavDropdown();

  bindOrderFormDdMmYyyyInputs();

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
      setMessage(ok ? "Сохранено" : "Ошибка сохранения или неверное значение", ok ? "" : "#d32f2f");
    });
    settingsInstallerRateInput.addEventListener("input", updateSettingsSaveButtonState);
    settingsInstallerRateInput.addEventListener("change", updateSettingsSaveButtonState);
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
        adjInput.addEventListener("input", updateAdjustmentsSaveButtonState);
        adjInput.addEventListener("change", updateAdjustmentsSaveButtonState);
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
        switchSection("all");
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

  // "О" и "М" переключатели справа от заголовка "Заказы".
  // Они управляют фильтром по типу заказов в таблице.
  const ordersTypeToggleO = document.getElementById("ordersTypeToggleO");
  const ordersTypeToggleM = document.getElementById("ordersTypeToggleM");
  if (ordersTypeToggleO && ordersTypeToggleM) {
    const ORDERS_TYPE_TOGGLE_STORAGE_KEY = "ordersTypeToggles";
    const ORDER_TYPE_KEYS_O = ["__empty__", "Окна", "Подоконники", "Аллюминий", "Сетки/мелочь"];
    const ORDER_TYPE_KEYS_M = ["Магазин"];
    const ALL_KEYS = isUserLite() ? ORDER_TYPE_KEYS_O : [...ORDER_TYPE_KEYS_O, ...ORDER_TYPE_KEYS_M];

    // Для user_lite фильтр "Магазин" скрыт в старом выпадающем меню, поэтому и этот переключатель скрываем.
    if (isUserLite()) ordersTypeToggleM.hidden = true;

    function readSavedToggles() {
      try {
        const raw = window.localStorage.getItem(ORDERS_TYPE_TOGGLE_STORAGE_KEY);
        if (!raw) return { oOn: true, mOn: false };
        const parsed = JSON.parse(raw);
        return {
          oOn: parsed?.oOn !== false,
          mOn: parsed?.mOn === true,
        };
      } catch {
        return { oOn: true, mOn: false };
      }
    }

    function saveToggles() {
      try {
        window.localStorage.setItem(ORDERS_TYPE_TOGGLE_STORAGE_KEY, JSON.stringify({ oOn, mOn }));
      } catch {
        // ignore localStorage failures
      }
    }

    let { oOn, mOn } = readSavedToggles();
    if (isUserLite()) mOn = false;

    function setTogglesFromState() {
      if (!state.orderTypeFilterSelected || state.orderTypeFilterSelected.length === 0) {
        return;
      }
      oOn = state.orderTypeFilterSelected.some((k) => ORDER_TYPE_KEYS_O.includes(k));
      mOn = state.orderTypeFilterSelected.includes("Магазин");
      if (isUserLite()) mOn = false;
    }

    function syncUI() {
      const setActive = (el, on) => {
        if (!el) return;
        el.classList.toggle("orders-type-toggle--active", !!on);
        el.setAttribute("aria-checked", String(!!on));
      };
      setActive(ordersTypeToggleO, oOn);
      setActive(ordersTypeToggleM, mOn);
    }

    function applyFromToggles() {
      const selected = [];
      if (oOn) selected.push(...ORDER_TYPE_KEYS_O);
      if (mOn) selected.push(...ORDER_TYPE_KEYS_M);

      // Если выключили оба — намеренно показать "ничего".
      state.orderTypeFilterSelected = selected.length === 0 ? ["__none__"] : selected;

      // Если выбрали все доступные типы — фильтр пустой (показывать всё).
      if (state.orderTypeFilterSelected.length === ALL_KEYS.length) {
        const setAll = new Set(ALL_KEYS);
        const isAll =
          state.orderTypeFilterSelected.every((k) => setAll.has(k)) &&
          state.orderTypeFilterSelected.every((k) => setAll.has(k));
        if (isAll) state.orderTypeFilterSelected = [];
      }

      saveToggles();
      applyClientFilter();
      syncUI();
    }

    function onToggle(kind) {
      // Переключатели актуальны только на странице "Заказы".
      const sectionAll = document.getElementById("section-all");
      if (!sectionAll || !sectionAll.classList.contains("active")) return;

      if (kind === "O") {
        oOn = !oOn;
      } else if (kind === "M") {
        if (isUserLite()) return;
        mOn = !mOn;
      }
      applyFromToggles();
    }

    ordersTypeToggleO.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      onToggle("O");
    });
    ordersTypeToggleM.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      onToggle("M");
    });

    ordersTypeToggleO.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        onToggle("O");
      }
    });
    ordersTypeToggleM.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        onToggle("M");
      }
    });

    applyFromToggles();

    document.addEventListener("orders-filters-updated", () => {
      // Пересинхронизируем переключатели с тем, что выбрал пользователь в dropdown.
      setTogglesFromState();
      saveToggles();
      syncUI();
    });
  }

  if (selectFilesBtn) {
    selectFilesBtn.addEventListener("click", () => {
      attachmentsInput.click();
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
    resetFormMode();
    switchSection("all");
  };
  if (cancelEditBtn) cancelEditBtn.addEventListener("click", onCancelEdit);
  if (cancelEditBtnTop) cancelEditBtnTop.addEventListener("click", onCancelEdit);

  if (logoutBtn) {
    logoutBtn.addEventListener("click", logout);
  }

  const backToOrdersBtn = document.getElementById("backToOrdersBtn");
  if (backToOrdersBtn) {
    backToOrdersBtn.addEventListener("click", () => {
      switchSection("all");
    });
  }

  let tooltipHideClick = null;
  let tooltipHideKey = null;

  /** Текст обрезан ellipsis: для «Клиент» обрезка на внутреннем .status-value, не на td */
  function isOrdersTableCellTruncated(td) {
    if (!td) return false;
    if (td.classList.contains("td-truncate-name")) {
      const chip = td.querySelector(".status-value");
      if (chip) return chip.scrollWidth > chip.clientWidth + 0.5;
    }
    return td.scrollWidth > td.clientWidth + 0.5;
  }

  function showCellTooltip(td) {
    if (!cellTooltip || !td) return;
    if (!isOrdersTableCellTruncated(td)) return;
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
        e.stopPropagation();
        e.preventDefault();
        openOrderIdActionsMenu(idTd);
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
      if (e.target.closest("a.order-id-actions-menu-item")) {
        closeOrderIdActionsMenu();
        return;
      }
      const btn = e.target.closest("button[data-action]");
      if (!btn || !orderIdActionsMenu.contains(btn)) return;
      const action = btn.dataset.action;
      const id = Number(orderIdActionsMenu.dataset.currentOrderId);
      if (Number.isNaN(id)) return;
      if (action === "edit") {
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