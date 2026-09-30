import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import { refreshOrdersTableStickyHeader } from "./ordersTableStickyHeader.js";
import {
  DEFAULT_ORDERS_ADDRESS_COLUMN_WIDTH,
  MIN_ORDERS_ADDRESS_COLUMN_WIDTH,
  MAX_ORDERS_ADDRESS_COLUMN_WIDTH,
  normalizeOrdersAddressColumnWidth,
  resolveOrdersAddressColumnWidth,
} from "./orders-address-column-width-utils.js";

const STORAGE_PREFIX = "orders_site_address_column_width_v1:";
const METADATA_KEY = "orders_address_column_width_px";

let activeUserId = null;
let activeWidth = DEFAULT_ORDERS_ADDRESS_COLUMN_WIDTH;
let initialized = false;
let modalReturnFocus = null;

function storageKey(userId) {
  return `${STORAGE_PREFIX}${userId}`;
}

function readLocalWidth(userId) {
  if (!userId) return null;
  try {
    return localStorage.getItem(storageKey(userId));
  } catch {
    return null;
  }
}

function writeLocalWidth(userId, width) {
  if (!userId) return;
  try {
    localStorage.setItem(storageKey(userId), String(width));
  } catch {
    /* Настройка всё равно применяется на текущей странице. */
  }
}

function refreshOrdersTableWidthDependants() {
  requestAnimationFrame(() => {
    const horizontal = document.getElementById("ordersTableScrollInner");
    const spacer = document.getElementById("ordersTableScrollSpacer");
    if (horizontal && spacer) spacer.style.width = `${horizontal.scrollWidth}px`;
    refreshOrdersTableStickyHeader();
    requestAnimationFrame(() => {
      if (horizontal && spacer) spacer.style.width = `${horizontal.scrollWidth}px`;
      refreshOrdersTableStickyHeader();
    });
  });
}

function applyWidth(width) {
  activeWidth = normalizeOrdersAddressColumnWidth(width) ?? DEFAULT_ORDERS_ADDRESS_COLUMN_WIDTH;
  document.documentElement.style.setProperty(
    "--orders-address-column-width",
    `${activeWidth}px`,
  );
  refreshOrdersTableWidthDependants();
}

function closeModal() {
  const modal = document.getElementById("ordersAddressWidthModal");
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  const button = document.getElementById("ordersAddressWidthBtn");
  button?.setAttribute("aria-expanded", "false");
  const returnTo = modalReturnFocus?.isConnected ? modalReturnFocus : button;
  modalReturnFocus = null;
  try {
    returnTo?.focus({ preventScroll: true });
  } catch {
    returnTo?.focus();
  }
}

function openModal() {
  const modal = document.getElementById("ordersAddressWidthModal");
  const input = document.getElementById("ordersAddressWidthInput");
  const status = document.getElementById("ordersAddressWidthStatus");
  if (!modal || !(input instanceof HTMLInputElement)) return;
  modalReturnFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (status) status.textContent = "";
  input.value = String(activeWidth);
  modal.hidden = false;
  document.getElementById("ordersAddressWidthBtn")?.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

async function persistWidth(width) {
  writeLocalWidth(activeUserId, width);
  const currentMetadata = state.currentUser?.user_metadata || {};
  try {
    const { data, error } = await supabaseClient.auth.updateUser({
      data: { ...currentMetadata, [METADATA_KEY]: width },
    });
    if (!error && data?.user) state.currentUser = data.user;
    return error;
  } catch (error) {
    return error;
  }
}

function bindModal() {
  if (initialized) return;
  initialized = true;

  document.getElementById("ordersAddressWidthBtn")?.addEventListener("click", openModal);
  document.querySelectorAll("[data-address-width-close]").forEach((button) => {
    button.addEventListener("click", closeModal);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModal();
  });

  document.getElementById("ordersAddressWidthForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.getElementById("ordersAddressWidthInput");
    const status = document.getElementById("ordersAddressWidthStatus");
    const saveButton = document.getElementById("ordersAddressWidthSaveBtn");
    const width = normalizeOrdersAddressColumnWidth(input?.value);
    if (width == null) {
      if (status) {
        status.textContent = `Введите целое число от ${MIN_ORDERS_ADDRESS_COLUMN_WIDTH} до ${MAX_ORDERS_ADDRESS_COLUMN_WIDTH}.`;
        status.dataset.kind = "error";
      }
      input?.focus();
      return;
    }

    applyWidth(width);
    if (status) {
      status.textContent = "Сохраняю настройку…";
      status.dataset.kind = "";
    }
    if (saveButton) saveButton.disabled = true;
    const error = await persistWidth(width);
    if (saveButton) saveButton.disabled = false;
    if (error) {
      if (status) {
        status.textContent = "Ширина применена на этом устройстве, но синхронизация с профилем не удалась.";
        status.dataset.kind = "error";
      }
      return;
    }
    closeModal();
  });
}

export function initOrdersAddressColumnWidth(user) {
  activeUserId = user?.id || null;
  const localWidth = readLocalWidth(activeUserId);
  const metadataWidth = user?.user_metadata?.[METADATA_KEY];
  const width = resolveOrdersAddressColumnWidth(localWidth, metadataWidth);
  writeLocalWidth(activeUserId, width);
  applyWidth(width);
  bindModal();
}
