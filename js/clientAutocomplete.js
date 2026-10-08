import { state } from "./state.js";
import { phoneInput } from "./dom.js";
import { supabaseClient } from "./config.js";

const MIN_CHARS = 3;
const DEBOUNCE_MS = 220;
const MAX_ITEMS = 15;
const ADDRESS_MAX_ITEMS = 10;
const ADDRESS_DEBOUNCE_MS = 280;
const ADDRESS_CACHE_TTL_MS = 10 * 60 * 1000;
const ADDRESS_CACHE_MAX = 80;

/** @type {Map<string, { expiresAt: number, items: Array<object> }>} */
const remoteAddressCache = new Map();

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

function normalizeSuggestionKey(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/\s+/g, " ");
}

function rememberRemoteAddressSuggestions(query, items) {
  const key = normalizeSuggestionKey(query);
  remoteAddressCache.delete(key);
  while (remoteAddressCache.size >= ADDRESS_CACHE_MAX) {
    const oldestKey = remoteAddressCache.keys().next().value;
    if (oldestKey == null) break;
    remoteAddressCache.delete(oldestKey);
  }
  remoteAddressCache.set(key, {
    expiresAt: Date.now() + ADDRESS_CACHE_TTL_MS,
    items,
  });
}

function readRemoteAddressSuggestions(query) {
  const key = normalizeSuggestionKey(query);
  const cached = remoteAddressCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    remoteAddressCache.delete(key);
    return null;
  }
  return cached.items;
}

function localAddressSuggestions(query) {
  return getFieldSuggestions("address", query).map((item) => ({
    value: item.name,
    title: item.name,
    count: item.count,
    source: "orders",
  }));
}

function mergeAddressSuggestions(localItems, remoteItems) {
  const merged = [];
  const seen = new Set();
  const local = localItems || [];
  // Сохраняем несколько часто используемых адресов сверху, но не даём истории
  // заказов полностью вытеснить новые адреса из внешнего справочника.
  const candidates = [...local.slice(0, 3), ...(remoteItems || []), ...local.slice(3)];
  for (const item of candidates) {
    const value = String(item?.value || item?.title || "").trim();
    const key = normalizeSuggestionKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...item, value, title: String(item?.title || value).trim() || value });
    if (merged.length >= ADDRESS_MAX_ITEMS) break;
  }
  return merged;
}

async function fetchRemoteAddressSuggestions(query, signal) {
  const cached = readRemoteAddressSuggestions(query);
  if (cached) return cached;

  const { data } = await supabaseClient.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) return [];

  const params = new URLSearchParams({ text: query.trim() });
  const response = await fetch(`/api/address-suggest?${params}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal,
  });
  if (!response.ok) return [];
  const body = await response.json();
  const items = (Array.isArray(body?.items) ? body.items : [])
    .map((item) => ({
      value: String(item?.value || "").trim(),
      title: String(item?.title || item?.value || "").trim(),
      source: "dadata",
    }))
    .filter((item) => item.value);
  rememberRemoteAddressSuggestions(query, items);
  return items;
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
 *   getSuggestions?: (query: string) => Array<{ name: string, count: number }>,
 *   minChars?: number,
 *   debounceMs?: number,
 *   countAriaLabel?: string,
 * }} opts
 */
export function attachFieldAutocomplete({
  input,
  list,
  wrap,
  field,
  onPick,
  clearInvalidClass,
  getSuggestions,
  minChars = MIN_CHARS,
  debounceMs = DEBOUNCE_MS,
  countAriaLabel = "Заказов",
}) {
  if (!input || !list || !wrap) return () => {};

  let debounceTimer = null;
  let blurTimer = null;
  let highlightedIndex = -1;
  /** После выбора из списка не показывать подсказки, пока значение поля не изменится. */
  let suppressUntilValueChange = null;

  const hide = () => {
    list.hidden = true;
    list.innerHTML = "";
    highlightedIndex = -1;
  };

  const clearInvalid = () => {
    if (clearInvalidClass) input.classList.remove(clearInvalidClass);
  };

  const isSuppressed = () =>
    suppressUntilValueChange !== null && input.value === suppressUntilValueChange;

  const pickSuggestion = (value) => {
    input.value = value;
    clearInvalid();
    suppressUntilValueChange = value;
    hide();
    input.focus();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    if (typeof onPick === "function") onPick(value);
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
      li.innerHTML = `<span class="client-suggestion-text">${escapeHtml(item.name)}</span><span class="client-suggestion-count" aria-label="${escapeHtml(countAriaLabel)}">${item.count}</span>`;
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        pickSuggestion(item.name);
      });
      list.appendChild(li);
    });
    list.hidden = false;
  };

  const refresh = () => {
    if (isSuppressed()) {
      hide();
      return;
    }
    const q = input.value;
    if (q.trim().length < minChars) {
      hide();
      return;
    }
    const items =
      typeof getSuggestions === "function"
        ? getSuggestions(q)
        : getFieldSuggestions(field, q);
    renderAndShow(items);
  };

  const onInput = () => {
    clearInvalid();
    if (suppressUntilValueChange !== null && input.value !== suppressUntilValueChange) {
      suppressUntilValueChange = null;
    }
    clearTimeout(debounceTimer);
    if (isSuppressed()) {
      hide();
      return;
    }
    debounceTimer = setTimeout(refresh, debounceMs);
  };

  const onFocus = () => {
    if (isSuppressed()) return;
    if (input.value.trim().length >= minChars) {
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

/** Подсказки адресов: сначала локальные совпадения, затем справочник ФИАС/ГАР DaData. */
function attachAddressAutocomplete({ input, list, wrap }) {
  if (!input || !list || !wrap) return () => {};

  let debounceTimer = null;
  let blurTimer = null;
  let requestController = null;
  let requestGeneration = 0;
  let highlightedIndex = -1;
  let currentItems = [];
  let suppressUntilValueChange = null;

  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", list.id);
  input.setAttribute("aria-expanded", "false");

  const hide = () => {
    list.hidden = true;
    list.innerHTML = "";
    highlightedIndex = -1;
    currentItems = [];
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  };

  const isSuppressed = () =>
    suppressUntilValueChange !== null && input.value === suppressUntilValueChange;

  const pickSuggestion = (item) => {
    const value = String(item?.value || "").trim();
    if (!value) return;
    input.value = value;
    input.classList.remove("address-invalid");
    suppressUntilValueChange = value;
    requestController?.abort();
    hide();
    input.focus();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    applyClientAndPhoneFromAddressPick(value);
  };

  const render = (items) => {
    currentItems = items;
    highlightedIndex = -1;
    list.innerHTML = "";
    if (!items.length || document.activeElement !== input) {
      hide();
      return;
    }

    items.forEach((item, index) => {
      const li = document.createElement("li");
      li.id = `${list.id}-option-${index}`;
      li.setAttribute("role", "option");
      li.dataset.index = String(index);
      const badge = item.source === "orders" ? String(item.count || "") : "DaData";
      li.innerHTML = `<span class="address-suggestion-content"><span class="client-suggestion-text">${escapeHtml(item.title || item.value)}</span></span><span class="client-suggestion-count address-suggestion-source">${escapeHtml(badge)}</span>`;
      li.addEventListener("mousedown", (event) => {
        event.preventDefault();
        pickSuggestion(item);
      });
      list.appendChild(li);
    });
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };

  const refresh = async () => {
    const query = input.value.trim();
    if (query.length < MIN_CHARS || isSuppressed()) {
      hide();
      return;
    }

    const generation = ++requestGeneration;
    requestController?.abort();
    const controller = new AbortController();
    requestController = controller;
    const localItems = localAddressSuggestions(query);
    render(mergeAddressSuggestions(localItems, []));

    try {
      const remoteItems = await fetchRemoteAddressSuggestions(query, controller.signal);
      if (
        generation !== requestGeneration ||
        controller.signal.aborted ||
        input.value.trim() !== query ||
        isSuppressed()
      ) {
        return;
      }
      render(mergeAddressSuggestions(localItems, remoteItems));
    } catch (error) {
      if (error?.name !== "AbortError") {
        console.warn("Подсказки адресов DaData недоступны:", error);
      }
    }
  };

  const onInput = () => {
    input.classList.remove("address-invalid");
    if (suppressUntilValueChange !== null && input.value !== suppressUntilValueChange) {
      suppressUntilValueChange = null;
    }
    clearTimeout(debounceTimer);
    requestController?.abort();
    requestGeneration += 1;
    if (input.value.trim().length < MIN_CHARS || isSuppressed()) {
      hide();
      return;
    }
    debounceTimer = setTimeout(() => void refresh(), ADDRESS_DEBOUNCE_MS);
  };

  const onFocus = () => {
    if (input.value.trim().length >= MIN_CHARS && !isSuppressed()) {
      clearTimeout(debounceTimer);
      void refresh();
    }
  };

  const onBlur = () => {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(hide, 180);
  };

  const updateHighlight = (nextIndex) => {
    const options = [...list.querySelectorAll("li")];
    highlightedIndex = nextIndex;
    options.forEach((option, index) => {
      option.setAttribute("aria-selected", index === highlightedIndex ? "true" : "false");
    });
    const active = options[highlightedIndex];
    if (active) {
      input.setAttribute("aria-activedescendant", active.id);
      active.scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  };

  const onKeydown = (event) => {
    if (event.key === "Escape" && !list.hidden) {
      event.preventDefault();
      requestController?.abort();
      hide();
      return;
    }
    if (list.hidden || !currentItems.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      updateHighlight(Math.min(highlightedIndex + 1, currentItems.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      updateHighlight(highlightedIndex <= 0 ? -1 : highlightedIndex - 1);
    } else if (event.key === "Enter" && highlightedIndex >= 0) {
      event.preventDefault();
      pickSuggestion(currentItems[highlightedIndex]);
    }
  };

  const onDocClick = (event) => {
    if (!wrap.contains(event.target)) hide();
  };

  input.addEventListener("input", onInput);
  input.addEventListener("focus", onFocus);
  input.addEventListener("blur", onBlur);
  input.addEventListener("keydown", onKeydown);
  document.addEventListener("click", onDocClick);

  return () => {
    clearTimeout(debounceTimer);
    clearTimeout(blurTimer);
    requestController?.abort();
    input.removeEventListener("input", onInput);
    input.removeEventListener("focus", onFocus);
    input.removeEventListener("blur", onBlur);
    input.removeEventListener("keydown", onKeydown);
    document.removeEventListener("click", onDocClick);
    hide();
  };
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
  const input = document.getElementById("address");
  const list = document.getElementById("addressSuggestions");
  const wrap = document.querySelector(".address-input-wrap");
  if (!(input instanceof HTMLInputElement) || !list || !wrap) return;
  attachAddressAutocomplete({ input, list, wrap });
}
