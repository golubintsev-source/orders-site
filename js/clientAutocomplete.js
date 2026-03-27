import { state } from "./state.js";

const MIN_CHARS = 3;
const DEBOUNCE_MS = 220;
const MAX_ITEMS = 15;

function escapeHtml(s) {
  if (s == null) return "";
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
}

/** Частота имён клиента по всем загруженным заказам (из базы через loadOrders). */
function buildClientCountMap() {
  const map = new Map();
  for (const o of state.allOrders || []) {
    const c = (o.client || "").trim();
    if (!c) continue;
    map.set(c, (map.get(c) || 0) + 1);
  }
  return map;
}

function getSuggestions(query) {
  const q = query.trim().toLowerCase();
  if (q.length < MIN_CHARS) return [];
  const map = buildClientCountMap();
  const out = [];
  for (const [name, count] of map) {
    if (name.toLowerCase().includes(q)) {
      out.push({ name, count });
    }
  }
  out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ru"));
  return out.slice(0, MAX_ITEMS);
}

export function initClientAutocomplete() {
  const input = document.getElementById("client");
  const list = document.getElementById("clientSuggestions");
  const wrap = document.querySelector(".client-input-wrap");
  if (!input || !list || !wrap) return;

  let debounceTimer = null;
  let blurTimer = null;
  let highlightedIndex = -1;

  const hide = () => {
    list.hidden = true;
    list.innerHTML = "";
    highlightedIndex = -1;
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
        input.classList.remove("client-invalid");
        hide();
        input.focus();
        input.dispatchEvent(new Event("input", { bubbles: true }));
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
    renderAndShow(getSuggestions(q));
  };

  input.addEventListener("input", () => {
    input.classList.remove("client-invalid");
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(refresh, DEBOUNCE_MS);
  });

  input.addEventListener("focus", () => {
    if (input.value.trim().length >= MIN_CHARS) {
      clearTimeout(debounceTimer);
      refresh();
    }
  });

  input.addEventListener("blur", () => {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(hide, 180);
  });

  input.addEventListener("keydown", (e) => {
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
  });

  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) hide();
  });
}
