import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import { attachFieldAutocomplete } from "./clientAutocomplete.js";
import {
  formatAmount,
  MSG_SUM_INTEGER_ONLY,
  refreshRublesIntegerInputState,
  tryParseRublesInteger,
} from "./format.js";
import { raceWithTimeout } from "./offline-cache.js";
import { shortLoginByEmail } from "./user-names.js";

let excessesBound = false;
let excessesRowsCache = [];
let rowSeq = 0;

function escapeHtml(s) {
  if (s == null) return "";
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
}

function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function setFormMessage(text, isError = false) {
  const el = document.getElementById("excessFormMessage");
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = "";
    el.classList.remove("excess-form-message--error");
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.classList.toggle("excess-form-message--error", isError);
}

function setTableMessage(text) {
  const el = document.getElementById("excessesMessage");
  if (!el) return;
  el.textContent = text || "";
}

function getRowsList() {
  return document.getElementById("excessRowsList");
}

function getFormPanel() {
  return document.getElementById("excessFormPanel");
}

function getStartBtn() {
  return document.getElementById("excessAddClientBtn");
}

function showFormPanel(show) {
  const panel = getFormPanel();
  const startBtn = getStartBtn();
  if (panel) panel.hidden = !show;
  if (startBtn) startBtn.hidden = show;
}

function createExcessRow(initial = { client: "", amount: "" }) {
  const list = getRowsList();
  if (!list) return null;

  rowSeq += 1;
  const id = rowSeq;

  const row = document.createElement("div");
  row.className = "excess-row";
  row.dataset.rowId = String(id);

  row.innerHTML = `
    <div class="field excess-client-field">
      <label for="excessClient_${id}">Клиент</label>
      <div class="client-input-wrap excess-client-input-wrap">
        <input type="text" id="excessClient_${id}" class="excess-client-input" autocomplete="off" />
        <ul class="client-suggestions excess-client-suggestions" hidden role="listbox"></ul>
      </div>
    </div>
    <div class="field excess-amount-field">
      <label for="excessAmount_${id}">Сумма</label>
      <input type="text" id="excessAmount_${id}" class="excess-amount-input" inputmode="numeric" title="Только целые рубли, без копеек" />
    </div>
    <button type="button" class="excess-row-remove-btn" title="Удалить строку" aria-label="Удалить строку">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;

  const clientInput = row.querySelector(".excess-client-input");
  const amountInput = row.querySelector(".excess-amount-input");
  const listEl = row.querySelector(".excess-client-suggestions");
  const wrap = row.querySelector(".excess-client-input-wrap");
  const removeBtn = row.querySelector(".excess-row-remove-btn");

  if (clientInput instanceof HTMLInputElement) {
    clientInput.value = initial.client || "";
  }
  if (amountInput instanceof HTMLInputElement) {
    amountInput.value = initial.amount || "";
    amountInput.addEventListener("input", () => {
      refreshRublesIntegerInputState(amountInput, amountInput.value);
    });
  }

  if (clientInput instanceof HTMLInputElement && listEl && wrap) {
    attachFieldAutocomplete({
      input: clientInput,
      list: listEl,
      wrap,
      field: "client",
    });
  }

  removeBtn?.addEventListener("click", () => {
    row.remove();
    const remaining = list.querySelectorAll(".excess-row").length;
    if (remaining === 0) {
      showFormPanel(false);
      setFormMessage("");
    }
  });

  list.appendChild(row);
  return row;
}

function collectRowsFromDom() {
  const list = getRowsList();
  if (!list) return [];
  const rows = [];
  list.querySelectorAll(".excess-row").forEach((row) => {
    const clientInput = row.querySelector(".excess-client-input");
    const amountInput = row.querySelector(".excess-amount-input");
    const client = (clientInput instanceof HTMLInputElement ? clientInput.value : "").trim();
    const amountRaw = amountInput instanceof HTMLInputElement ? amountInput.value : "";
    rows.push({ client, amountRaw, amountInput, clientInput });
  });
  return rows;
}

function resetFormToEmpty() {
  const list = getRowsList();
  if (list) list.innerHTML = "";
  showFormPanel(false);
  setFormMessage("");
}

function startWithClientRow() {
  showFormPanel(true);
  setFormMessage("");
  const list = getRowsList();
  if (list && list.querySelectorAll(".excess-row").length === 0) {
    const row = createExcessRow();
    const input = row?.querySelector(".excess-client-input");
    if (input instanceof HTMLInputElement) {
      queueMicrotask(() => input.focus());
    }
  }
}

function addEmptyRow() {
  showFormPanel(true);
  setFormMessage("");
  const row = createExcessRow();
  const input = row?.querySelector(".excess-client-input");
  if (input instanceof HTMLInputElement) {
    queueMicrotask(() => input.focus());
  }
}

async function saveExcessRows() {
  const rows = collectRowsFromDom();
  if (rows.length === 0) {
    setFormMessage("Добавьте хотя бы одну строку.", true);
    return;
  }

  const payloads = [];
  for (const row of rows) {
    const hasClient = Boolean(row.client);
    const amountParsed = tryParseRublesInteger(row.amountRaw);
    const hasAmount = String(row.amountRaw ?? "").trim() !== "";

    if (!hasClient && !hasAmount) continue;

    if (!hasClient) {
      setFormMessage("Укажите клиента во всех заполненных строках.", true);
      row.clientInput?.focus();
      return;
    }
    if (!hasAmount) {
      setFormMessage("Укажите сумму во всех заполненных строках.", true);
      row.amountInput?.focus();
      return;
    }
    if (!amountParsed.ok || amountParsed.value == null) {
      setFormMessage(MSG_SUM_INTEGER_ONLY, true);
      if (row.amountInput) refreshRublesIntegerInputState(row.amountInput, row.amountRaw);
      row.amountInput?.focus();
      return;
    }

    payloads.push({
      client: row.client,
      amount: amountParsed.value,
      created_by: state.currentUser?.email || null,
      created_at: new Date().toISOString(),
    });
  }

  if (payloads.length === 0) {
    setFormMessage("Заполните хотя бы одну строку: клиент и сумма.", true);
    return;
  }

  const saveBtn = document.getElementById("excessSaveBtn");
  if (saveBtn) saveBtn.disabled = true;

  try {
    const result = await raceWithTimeout(
      supabaseClient.from("excesses").insert(payloads).select(),
    );
    if (result?.error) {
      console.error("excesses insert:", result.error);
      setFormMessage("Не удалось сохранить излишки. Проверьте таблицу excesses в Supabase.", true);
      return;
    }
    resetFormToEmpty();
    setFormMessage(`Сохранено записей: ${payloads.length}.`);
    await loadExcesses();
  } catch (err) {
    console.error("excesses save:", err);
    setFormMessage("Ошибка сохранения. Проверьте интернет и настройки Supabase.", true);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

function renderExcessesTable(rows) {
  const tbody = document.querySelector("#excessesTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!rows.length) {
    setTableMessage("Пока нет сохранённых излишков.");
    return;
  }
  setTableMessage("");

  for (const row of rows) {
    const tr = document.createElement("tr");
    const author = shortLoginByEmail(row.created_by) || "—";
    const amount =
      row.amount != null && row.amount !== "" ? `${formatAmount(row.amount)}\u00A0₽` : "—";
    tr.innerHTML = `
      <td>${escapeHtml(formatDateTime(row.created_at))}</td>
      <td>${escapeHtml(author)}</td>
      <td>${escapeHtml(row.client || "")}</td>
      <td class="td-money">${escapeHtml(amount)}</td>
      <td class="td-actions">
        <button type="button" class="btn-icon btn-delete excess-delete-btn" data-id="${escapeHtml(String(row.id))}" title="Удалить" aria-label="Удалить">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

async function deleteExcess(id) {
  const n = Number(id);
  if (!Number.isFinite(n)) return;
  if (!window.confirm("Удалить запись излишка?")) return;

  try {
    const result = await raceWithTimeout(
      supabaseClient
        .from("excesses")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", n),
    );
    if (result?.error) {
      console.error("excesses delete:", result.error);
      setTableMessage("Не удалось удалить запись.");
      return;
    }
    await loadExcesses();
  } catch (err) {
    console.error("excesses delete:", err);
    setTableMessage("Ошибка удаления.");
  }
}

export async function loadExcesses() {
  try {
    const result = await raceWithTimeout(
      supabaseClient
        .from("excesses")
        .select("id, created_at, client, amount, created_by")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(500),
    );
    if (result?.error) {
      console.error("excesses load:", result.error);
      excessesRowsCache = [];
      renderExcessesTable([]);
      setTableMessage("Не удалось загрузить излишки. Выполните supabase_excesses_table.sql в Supabase.");
      return;
    }
    excessesRowsCache = Array.isArray(result?.data) ? result.data : [];
    renderExcessesTable(excessesRowsCache);
  } catch (err) {
    console.error("excesses load:", err);
    excessesRowsCache = [];
    renderExcessesTable([]);
    setTableMessage("Ошибка загрузки излишков.");
  }
}

export function bindExcessSection() {
  if (excessesBound) return;
  excessesBound = true;

  document.getElementById("excessAddClientBtn")?.addEventListener("click", () => {
    startWithClientRow();
  });

  document.getElementById("excessAddRowBtn")?.addEventListener("click", () => {
    addEmptyRow();
  });

  document.getElementById("excessSaveBtn")?.addEventListener("click", () => {
    void saveExcessRows();
  });

  document.querySelector("#excessesTable tbody")?.addEventListener("click", (e) => {
    const btn = e.target?.closest?.(".excess-delete-btn");
    if (!btn) return;
    void deleteExcess(btn.dataset.id);
  });
}
