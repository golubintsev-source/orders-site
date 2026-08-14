import { state } from "./state.js";
import { phoneInput } from "./dom.js";

const MIN_CHARS = 3;
const DEBOUNCE_MS = 220;
const MAX_ITEMS = 15;

function escapeHtml(s) {
  if (s == null) return "";
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
}

function sortOrdersLatestFirst(a, b) {
  const idA = Number(a.id) || 0;
  const idB = Number(b.id) || 0;
  if (idB !== idA) return idB - idA;
  const da = a.order_date || "";
  const db = b.order_date || "";
  return String(db).localeCompare(String(da));
}

/** Частота значений поля по всем загруженным заказам (из базы через loadOrders). */
function buildFieldCountMap(field) {
  const map = new Map();
  for (const o of state.allOrders || []) {
    const v = (o[field] || "").trim();
    if (!v) continue;
    map.set(v, (map.get(v) || 0) + 1);
  }
  return map;
}

function getFieldSuggestions(field, query) {
  const q = query.trim().toLowerCase();
  if (q.length < MIN_CHARS) return [];
  const map = buildFieldCountMap(field);
  const out = [];
  for (const [name, count] of map) {
    if (name.toLowerCase().includes(q)) {
      out.push({ name, count });
    }
  }
  out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ru"));
  return out.slice(0, MAX_ITEMS);
}

/**
 * Значение поля из самого свежего заказа с данным клиентом
 * (сначала по id, при равенстве — по order_date).
 */
function getLatestFieldForClient(clientName, field) {
  const name = (clientName || "").trim();
  if (!name) return null;
  const withValue = (state.allOrders || [])
    .filter((o) => (o.client || "").trim() === name)
    .map((o) => ({ o, value: (o[field] || "").trim() }))
    .filter((x) => x.value);
  if (withValue.length === 0) return null;
  withValue.sort((a, b) => sortOrdersLatestFirst(a.o, b.o));
  return withValue[0].value;
}

/**
 * Телефон из самого свежего заказа этого клиента (сначала по id, при равенстве — по order_date).
 */
export function getLatestPhoneForClient(clientName) {
  return getLatestFieldForClient(clientName, "phone");
}

/**
 * Адрес из самого свежего заказа этого клиента (сначала по id, при равенстве — по order_date).
 */
export function getLatestAddressForClient(clientName) {
  return getLatestFieldForClient(clientName, "address");
}

/** Самый свежий заказ с точным совпадением адреса. */
function getLatestOrderForAddress(address) {
  const addr = (address || "").trim();
  if (!addr) return null;
  const rows = (state.allOrders || []).filter((o) => (o.address || "").trim() === addr);
  if (rows.length === 0) return null;
  rows.sort(sortOrdersLatestFirst);
  return rows[0];
}

function setPhoneValue(phone) {
  if (!phoneInput || !phone) return;
  phoneInput.value = phone;
  phoneInput.dispatchEvent(new Event("input", { bubbles: true }));
}

function applyPhoneAndAddressFromClientPick(clientName) {
  const phone = getLatestPhoneForClient(clientName);
  if (phone) setPhoneValue(phone);

  const addressInput = document.getElementById("address");
  if (!addressInput) return;
  const address = getLatestAddressForClient(clientName);
  if (!address) return;
  addressInput.value = address;
  addressInput.classList.remove("address-invalid");
}

function applyClientAndPhoneFromAddressPick(address) {
  const order = getLatestOrderForAddress(address);
  if (!order) return;

  const clientInput = document.getElementById("client");
  const clientName = (order.client || "").trim();
  if (clientInput && clientName) {
    clientInput.value = clientName;
    clientInput.classList.remove("client-invalid");
  }

  let phone = (order.phone || "").trim();
  if (!phone && clientName) {
    phone = getLatestPhoneForClient(clientName) || "";
  }
  if (phone) setPhoneValue(phone);
}

/**
 * Общий выпадающий список подсказок для текстового поля.
 * @param {{
 *   input: HTMLInputElement,
 *   list: HTMLElement,
 *   wrap: HTMLElement,
 *   field: string,
 *   onPick?: (value: string) => void,
 *   clearInvalidClass?: string,
 * }} opts
 */
export function attachFieldAutocomplete({ input, list, wrap, field, onPick, clearInvalidClass }) {
  if (!input || !list || !wrap) return () => {};

  let debounceTimer = null;
  let blurTimer = null;
  let highlightedIndex = -1;

  const hide = () => {
    list.hidden = true;
    list.innerHTML = "";
    highlightedIndex = -1;
  };

  const clearInvalid = () => {
    if (clearInvalidClass) input.classList.remove(clearInvalidClass);
  };

  const renderAndShow = (items) => {
    list.innerHTML = "";
    highlightedIndex = -1;
    if (items.length === 0) {
      list.hidden = true;
      return;
    }
    items.forEach((item, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.dataset.index = String(i);
      li.innerHTML = `<span class="client-suggestion-text">${escapeHtml(item.name)}</span><span class="client-suggestion-count" aria-label="Заказов">${item.count}</span>`;
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        input.value = item.name;
        clearInvalid();
        hide();
        input.focus();
        input.dispatchEvent(new Event("input", { bubbles: true }));
        if (typeof onPick === "function") onPick(item.name);
      });
      list.appendChild(li);
    });
    list.hidden = false;
  };

  const refresh = () => {
    const q = input.value;
    if (q.trim().length < MIN_CHARS) {
      hide();
      return;
    }
    renderAndShow(getFieldSuggestions(field, q));
  };

  const onInput = () => {
    clearInvalid();
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(refresh, DEBOUNCE_MS);
  };

  const onFocus = () => {
    if (input.value.trim().length >= MIN_CHARS) {
      clearTimeout(debounceTimer);
      refresh();
    }
  };

  const onBlur = () => {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(hide, 180);
  };

  const onKeydown = (e) => {
    if (list.hidden || !list.querySelector("li")) return;
    const items = list.querySelectorAll("li");

    if (e.key === "Escape") {
      e.preventDefault();
      hide();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (highlightedIndex < 0) highlightedIndex = 0;
      else highlightedIndex = Math.min(highlightedIndex + 1, items.length - 1);
      items.forEach((el, i) => el.setAttribute("aria-selected", i === highlightedIndex ? "true" : "false"));
      items[highlightedIndex]?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (highlightedIndex <= 0) highlightedIndex = -1;
      else highlightedIndex -= 1;
      items.forEach((el, i) => el.setAttribute("aria-selected", i === highlightedIndex ? "true" : "false"));
      return;
    }
    if (e.key === "Enter" && highlightedIndex >= 0 && items[highlightedIndex]) {
      e.preventDefault();
      items[highlightedIndex].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    }
  };

  const onDocClick = (e) => {
    if (!wrap.contains(e.target)) hide();
  };

  input.addEventListener("input", onInput);
  input.addEventListener("focus", onFocus);
  input.addEventListener("blur", onBlur);
  input.addEventListener("keydown", onKeydown);
  document.addEventListener("click", onDocClick);

  return () => {
    clearTimeout(debounceTimer);
    clearTimeout(blurTimer);
    input.removeEventListener("input", onInput);
    input.removeEventListener("focus", onFocus);
    input.removeEventListener("blur", onBlur);
    input.removeEventListener("keydown", onKeydown);
    document.removeEventListener("click", onDocClick);
    hide();
  };
}

/**
 * Общий выпадающий список подсказок для поля формы заказа.
 * @param {{ inputId: string, listId: string, wrapSelector: string, field: string, onPick: (value: string) => void }} opts
 */
function initFieldAutocomplete({ inputId, listId, wrapSelector, field, onPick }) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
  const wrap = document.querySelector(wrapSelector);
  if (!(input instanceof HTMLInputElement) || !list || !wrap) return;

  attachFieldAutocomplete({
    input,
    list,
    wrap,
    field,
    onPick,
    clearInvalidClass:
      inputId === "client" ? "client-invalid" : inputId === "address" ? "address-invalid" : undefined,
  });
}

export function initClientAutocomplete() {
  initFieldAutocomplete({
    inputId: "client",
    listId: "clientSuggestions",
    wrapSelector: ".client-input-wrap",
    field: "client",
    onPick: applyPhoneAndAddressFromClientPick,
  });
}

export function initAddressAutocomplete() {
  initFieldAutocomplete({
    inputId: "address",
    listId: "addressSuggestions",
    wrapSelector: ".address-input-wrap",
    field: "address",
    onPick: applyClientAndPhoneFromAddressPick,
  });
}
