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
import { canSelectKassaBeznal, KASSA_BEZNAL_PLACES } from "./roles.js";

let excessesBound = false;
let excessesRowsCache = [];
let rowSeq = 0;
/** @type {number|null} */
let editingExcessId = null;

const EXCESS_ICON_EDIT_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
const EXCESS_ICON_DELETE_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;

/** Префикс автозаписей излишков в calculations (как [AUTO_ORDER_DELTA] для заказов). */
export const EXCESS_DELTA_CALC_COMMENT_PREFIX = "[AUTO_EXCESS_DELTA]";
/** Пустое значение в теле автокомментария расчёта. */
const CALC_COMMENT_EMPTY = "[__]";

const EXCESS_WHO_OPTIONS = [
  { value: "Дима", label: "Дима" },
  { value: "Вова", label: "Вова" },
  { value: "Безнал", label: "Безнал" },
  { value: "Касса", label: "Касса" },
];

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

function formatTimeHHmmFromIso(iso) {
  if (!iso) return "--:--";
  try {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mi}`;
  } catch {
    return "--:--";
  }
}

function toComparableNumber(v) {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatExcessHistoryAmount(v) {
  if (v == null || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? formatAmount(n) : "—";
}

function formatExcessHistoryPaidTo(v) {
  const t = normRecipientSelect(v);
  return t || "—";
}

function valuesEqualExcessHistory(a, b) {
  const sa = a == null || a === "" ? null : String(a).trim();
  const sb = b == null || b === "" ? null : String(b).trim();
  if (sa == null && sb == null) return true;
  if (sa == null || sb == null) return false;
  return sa === sb;
}

function amountsEqualExcessHistory(a, b) {
  return Math.abs(toComparableNumber(a) - toComparableNumber(b)) < 0.000001;
}

/**
 * Комментарии для excess_history: по одной строке на каждое изменение
 * (как order_history / отдельные строки расчётов).
 * @param {Record<string, unknown>|null} prev
 * @param {Record<string, unknown>} next
 * @param {"create"|"edit"|"delete"} mode
 * @returns {string[]}
 */
function buildExcessHistoryComments(prev, next, mode) {
  if (mode === "delete") {
    const client = String(prev?.client ?? next?.client ?? "").trim() || "—";
    const amount = formatExcessHistoryAmount(prev?.amount ?? next?.amount);
    const paidTo = formatExcessHistoryPaidTo(prev?.paid_to ?? next?.paid_to);
    return [
      "Излишек удалён",
      `Клиент: ${client}`,
      `Сумма: ${amount}`,
      `Кому: ${paidTo}`,
    ];
  }

  if (mode === "create") {
    const comments = ["Излишек создан"];
    const client = String(next?.client ?? "").trim();
    if (client) comments.push(`Клиент: — -> ${client}`);
    if (next?.amount != null && next.amount !== "") {
      comments.push(`Сумма: — -> ${formatExcessHistoryAmount(next.amount)}`);
    }
    const paidTo = formatExcessHistoryPaidTo(next?.paid_to);
    if (paidTo !== "—") comments.push(`Кому: — -> ${paidTo}`);
    return comments;
  }

  const parts = [];
  const prevClient = String(prev?.client ?? "").trim();
  const nextClient = String(next?.client ?? "").trim();
  if (!valuesEqualExcessHistory(prevClient, nextClient)) {
    parts.push(`Клиент: ${prevClient || "—"} -> ${nextClient || "—"}`);
  }
  if (!amountsEqualExcessHistory(prev?.amount, next?.amount)) {
    parts.push(
      `Сумма: ${formatExcessHistoryAmount(prev?.amount)} -> ${formatExcessHistoryAmount(next?.amount)}`,
    );
  }
  const prevPaid = formatExcessHistoryPaidTo(prev?.paid_to);
  const nextPaid = formatExcessHistoryPaidTo(next?.paid_to);
  if (prevPaid !== nextPaid) {
    parts.push(`Кому: ${prevPaid} -> ${nextPaid}`);
  }
  return parts.length > 0 ? parts : ["Сохранено без изменений"];
}

async function insertExcessHistoryComments(excessId, comments, userEmail) {
  const list = (comments || []).map((c) => String(c || "").trim()).filter(Boolean);
  if (list.length === 0) return { ok: true };
  const email = String(userEmail || state.currentUser?.email || "").trim();
  if (!email) {
    console.error("Ошибка записи истории излишков: нет email пользователя");
    return { ok: false, error: { message: "Нет email пользователя для истории" } };
  }
  const rows = list.map((comment) => ({
    excess_id: excessId != null ? Number(excessId) : null,
    user_email: email,
    comment,
  }));
  const { error } = await supabaseClient.from("excess_history").insert(rows);
  if (error) {
    console.error("Ошибка записи истории излишков:", error);
    return { ok: false, error };
  }
  return { ok: true };
}

function normRecipientSelect(v) {
  const t = String(v ?? "").trim();
  return t === "—" ? "" : t;
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

function getAddRowBtn() {
  return document.getElementById("excessAddRowBtn");
}

function getSaveBtn() {
  return document.getElementById("excessSaveBtn");
}

function isEditMode() {
  return editingExcessId != null;
}

function syncFormChrome() {
  const addRowBtn = getAddRowBtn();
  const addRowWrap = addRowBtn?.closest(".excess-form-add-wrap");
  const saveBtn = getSaveBtn();
  if (addRowWrap) addRowWrap.hidden = isEditMode();
  if (addRowBtn) addRowBtn.hidden = isEditMode();
  if (saveBtn) {
    saveBtn.textContent = isEditMode() ? "Сохранить изменения" : "Сохранить";
  }
}

function showFormPanel(show) {
  const panel = getFormPanel();
  const startBtn = getStartBtn();
  if (panel) panel.hidden = !show;
  if (startBtn) startBtn.hidden = show;
}

function isForbiddenKassaBeznalSelection(newVal, previousVal) {
  if (canSelectKassaBeznal()) return false;
  const next = String(newVal || "").trim();
  if (!KASSA_BEZNAL_PLACES.has(next)) return false;
  return next !== String(previousVal || "").trim();
}

function buildWhoSelectOptionsHtml(selectedValue = "") {
  const current = String(selectedValue || "").trim();
  const allowedKassaBeznal = canSelectKassaBeznal();
  const options = [`<option value="">—</option>`];
  for (const opt of EXCESS_WHO_OPTIONS) {
    if (KASSA_BEZNAL_PLACES.has(opt.value) && !allowedKassaBeznal && opt.value !== current) {
      continue;
    }
    const selected = opt.value === current ? " selected" : "";
    options.push(`<option value="${escapeHtml(opt.value)}"${selected}>${escapeHtml(opt.label)}</option>`);
  }
  if (current && !EXCESS_WHO_OPTIONS.some((o) => o.value === current)) {
    options.push(`<option value="${escapeHtml(current)}" selected>${escapeHtml(current)}</option>`);
  }
  return options.join("");
}

/**
 * Строки для calculations по схеме «Предоплата / Кому предоплата»:
 * пустой select и «—» = пусто; ветки добавления / снятия / смены суммы / смены получателя.
 */
export function buildExcessDeltaCalculationInsertRows({
  wasEditing,
  oldAmount,
  oldPaidTo,
  newAmount,
  newPaidTo,
  client,
}) {
  const nowIso = new Date().toISOString();
  const timeHHmm = formatTimeHHmmFromIso(nowIso);
  const actorShort = shortLoginByEmail(state.currentUser?.email);
  const clientStr = (client && String(client).trim()) || CALC_COMMENT_EMPTY;

  const toBefore = normRecipientSelect(wasEditing ? oldPaidTo : "");
  const toAfter = normRecipientSelect(newPaidTo);
  const toBeforeEmpty = toBefore === "";
  const toAfterEmpty = toAfter === "";
  const amountOld = wasEditing ? toComparableNumber(oldAmount) : 0;
  const amountNew = toComparableNumber(newAmount);
  const amountSame = Math.abs(amountOld - amountNew) < 0.000001;
  const toSame = toBefore === toAfter;

  const rows = [];

  const pushRow = ({ from_place, to_place, amount, detail }) => {
    if (Math.abs(amount) < 0.000001) return;
    rows.push({
      created_at: nowIso,
      from_place: from_place || "—",
      to_place: to_place || "—",
      amount,
      comment: `${EXCESS_DELTA_CALC_COMMENT_PREFIX} Излишек; ${clientStr}; ${detail}; ${timeHHmm}; ${actorShort}`,
    });
  };

  if ((toBeforeEmpty && toAfterEmpty) || (amountSame && toSame)) {
    return [];
  }

  if (toBeforeEmpty && !toAfterEmpty) {
    pushRow({
      from_place: "Клиент",
      to_place: toAfter,
      amount: amountNew,
      detail: `кому ${CALC_COMMENT_EMPTY} → ${toAfter}; сумма ${formatAmount(amountNew)}`,
    });
  } else if (!toBeforeEmpty && toAfterEmpty) {
    pushRow({
      from_place: toBefore,
      to_place: "Клиент",
      amount: amountOld,
      detail: `${toBefore} → клиент; сумма ${formatAmount(amountOld)}`,
    });
  } else if (!toBeforeEmpty && !toAfterEmpty && toSame) {
    pushRow({
      from_place: "Клиент",
      to_place: toAfter,
      amount: amountNew - amountOld,
      detail: `${toAfter}; ${formatAmount(amountOld)} → ${formatAmount(amountNew)}`,
    });
  } else if (!toBeforeEmpty && !toAfterEmpty && !toSame) {
    pushRow({
      from_place: toBefore,
      to_place: "Клиент",
      amount: amountOld,
      detail: `смена получателя; ${toBefore} → клиент; ${formatAmount(amountOld)}`,
    });
    pushRow({
      from_place: "Клиент",
      to_place: toAfter,
      amount: amountNew,
      detail: `смена получателя; клиент → ${toAfter}; ${formatAmount(amountNew)}`,
    });
  }

  return rows;
}

async function writeExcessDeltaCalculations(args) {
  const payload = buildExcessDeltaCalculationInsertRows(args);
  if (payload.length === 0) return;
  const { error } = await supabaseClient.from("calculations").insert(payload);
  if (error) {
    console.error("Автозапись дельт излишков в calculations:", error);
  }
}

function createExcessRow(initial = { client: "", amount: "", paid_to: "" }, options = {}) {
  const list = getRowsList();
  if (!list) return null;

  const clientReadonly = Boolean(options.clientReadonly);
  const hideRemove = Boolean(options.hideRemove);

  rowSeq += 1;
  const id = rowSeq;

  const row = document.createElement("div");
  row.className = "excess-row";
  row.dataset.rowId = String(id);
  if (clientReadonly) row.classList.add("excess-row--edit");

  row.innerHTML = `
    <div class="field excess-client-field">
      <label for="excessClient_${id}">Клиент</label>
      <div class="client-input-wrap excess-client-input-wrap">
        <input type="text" id="excessClient_${id}" class="excess-client-input" autocomplete="off" ${clientReadonly ? "readonly" : ""} />
        <ul class="client-suggestions excess-client-suggestions" hidden role="listbox"></ul>
      </div>
    </div>
    <div class="field excess-amount-field">
      <label for="excessAmount_${id}">Сумма</label>
      <input type="text" id="excessAmount_${id}" class="excess-amount-input" inputmode="numeric" title="Только целые рубли, без копеек" />
    </div>
    <div class="field excess-who-field">
      <label for="excessWho_${id}">Кому</label>
      <select id="excessWho_${id}" class="excess-who-select">
        ${buildWhoSelectOptionsHtml(initial.paid_to || "")}
      </select>
    </div>
    ${
      hideRemove
        ? ""
        : `<button type="button" class="excess-row-remove-btn" title="Удалить строку" aria-label="Удалить строку">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>`
    }
  `;

  const clientInput = row.querySelector(".excess-client-input");
  const amountInput = row.querySelector(".excess-amount-input");
  const whoSelect = row.querySelector(".excess-who-select");
  const listEl = row.querySelector(".excess-client-suggestions");
  const wrap = row.querySelector(".excess-client-input-wrap");
  const removeBtn = row.querySelector(".excess-row-remove-btn");

  if (clientInput instanceof HTMLInputElement) {
    clientInput.value = initial.client || "";
    if (clientReadonly) {
      clientInput.readOnly = true;
      clientInput.setAttribute("aria-readonly", "true");
    }
  }
  if (amountInput instanceof HTMLInputElement) {
    amountInput.value = initial.amount || "";
    amountInput.addEventListener("input", () => {
      refreshRublesIntegerInputState(amountInput, amountInput.value);
      refreshWhoRequiredState(row);
    });
  }
  if (whoSelect instanceof HTMLSelectElement) {
    whoSelect.addEventListener("change", () => {
      // Пересобрать опции с учётом роли и текущего значения (как в заказе).
      const keep = whoSelect.value;
      whoSelect.innerHTML = buildWhoSelectOptionsHtml(keep);
      whoSelect.value = keep;
      if (whoSelect.value !== keep) whoSelect.value = "";
      refreshWhoRequiredState(row);
    });
    refreshWhoRequiredState(row);
  }

  if (!clientReadonly && clientInput instanceof HTMLInputElement && listEl && wrap) {
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
      cancelEditMode();
      showFormPanel(false);
      setFormMessage("");
    }
  });

  list.appendChild(row);
  return row;
}

function refreshWhoRequiredState(row) {
  const amountInput = row?.querySelector?.(".excess-amount-input");
  const whoSelect = row?.querySelector?.(".excess-who-select");
  if (!(whoSelect instanceof HTMLSelectElement)) return;
  const hasAmount = String(amountInput instanceof HTMLInputElement ? amountInput.value : "").trim() !== "";
  const hasWho = Boolean(String(whoSelect.value || "").trim());
  whoSelect.classList.toggle("conditional-invalid", hasAmount && !hasWho);
}

function collectRowsFromDom() {
  const list = getRowsList();
  if (!list) return [];
  const rows = [];
  list.querySelectorAll(".excess-row").forEach((row) => {
    const clientInput = row.querySelector(".excess-client-input");
    const amountInput = row.querySelector(".excess-amount-input");
    const whoSelect = row.querySelector(".excess-who-select");
    const client = (clientInput instanceof HTMLInputElement ? clientInput.value : "").trim();
    const amountRaw = amountInput instanceof HTMLInputElement ? amountInput.value : "";
    const paidTo = (whoSelect instanceof HTMLSelectElement ? whoSelect.value : "").trim();
    rows.push({ client, amountRaw, paidTo, amountInput, clientInput, whoSelect });
  });
  return rows;
}

function cancelEditMode() {
  editingExcessId = null;
  syncFormChrome();
}

function resetFormToEmpty() {
  const list = getRowsList();
  if (list) list.innerHTML = "";
  cancelEditMode();
  showFormPanel(false);
  setFormMessage("");
}

function startWithClientRow() {
  cancelEditMode();
  showFormPanel(true);
  syncFormChrome();
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
  if (isEditMode()) return;
  showFormPanel(true);
  setFormMessage("");
  const row = createExcessRow();
  const input = row?.querySelector(".excess-client-input");
  if (input instanceof HTMLInputElement) {
    queueMicrotask(() => input.focus());
  }
}

function formatAmountForInput(value) {
  if (value == null || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return String(Math.trunc(n));
}

function startEditExcess(id) {
  const n = Number(id);
  if (!Number.isFinite(n)) return;
  const existing = excessesRowsCache.find((r) => Number(r.id) === n);
  if (!existing) {
    setTableMessage("Запись не найдена.");
    return;
  }

  editingExcessId = n;
  const list = getRowsList();
  if (list) list.innerHTML = "";
  showFormPanel(true);
  syncFormChrome();
  setFormMessage("Редактирование: можно изменить сумму или «Кому».");
  setTableMessage("");

  const row = createExcessRow(
    {
      client: existing.client || "",
      amount: formatAmountForInput(existing.amount),
      paid_to: existing.paid_to || "",
    },
    { clientReadonly: true, hideRemove: true },
  );
  const amountInput = row?.querySelector(".excess-amount-input");
  if (amountInput instanceof HTMLInputElement) {
    queueMicrotask(() => {
      amountInput.focus();
      amountInput.select();
    });
  }

  const panel = getFormPanel();
  panel?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
}

async function saveExcessRows() {
  if (isEditMode()) {
    await saveEditedExcess();
    return;
  }

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
    const paidTo = normRecipientSelect(row.paidTo);

    if (!hasClient && !hasAmount && !paidTo) continue;

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
    if (!paidTo) {
      setFormMessage("Укажите «Кому» во всех заполненных строках.", true);
      row.whoSelect?.focus();
      if (row.whoSelect) refreshWhoRequiredState(row.whoSelect.closest(".excess-row"));
      return;
    }
    if (isForbiddenKassaBeznalSelection(paidTo, "")) {
      setFormMessage("Выбор «Касса» или «Безнал» недоступен для вашей роли.", true);
      row.whoSelect?.focus();
      return;
    }

    payloads.push({
      client: row.client,
      amount: amountParsed.value,
      paid_to: paidTo,
      created_by: state.currentUser?.email || null,
      created_at: new Date().toISOString(),
    });
  }

  if (payloads.length === 0) {
    setFormMessage("Заполните хотя бы одну строку: клиент, сумма и «Кому».", true);
    return;
  }

  const saveBtn = getSaveBtn();
  if (saveBtn) saveBtn.disabled = true;

  try {
    const result = await raceWithTimeout(
      supabaseClient.from("excesses").insert(payloads).select(),
    );
    if (result?.error) {
      console.error("excesses insert:", result.error);
      setFormMessage(
        "Не удалось сохранить излишки. Проверьте таблицу excesses и поле paid_to в Supabase (supabase_excesses_paid_to.sql).",
        true,
      );
      return;
    }

    const savedRows = Array.isArray(result?.data) ? result.data : [];
    let historyWriteFailed = false;
    for (const item of savedRows.length > 0 ? savedRows : payloads) {
      await writeExcessDeltaCalculations({
        wasEditing: false,
        oldAmount: 0,
        oldPaidTo: "",
        newAmount: item.amount,
        newPaidTo: item.paid_to,
        client: item.client,
      });
      const hist = await insertExcessHistoryComments(
        item.id ?? null,
        buildExcessHistoryComments(null, item, "create"),
        item.created_by || state.currentUser?.email,
      );
      if (!hist.ok) historyWriteFailed = true;
    }

    resetFormToEmpty();
    if (historyWriteFailed) {
      setFormMessage(
        `Сохранено записей: ${payloads.length}. Внимание: не удалось записать историю для «Все изменения». Выполните supabase_excess_history_table.sql в Supabase.`,
        true,
      );
    } else {
      setFormMessage(`Сохранено записей: ${payloads.length}.`);
    }
    await loadExcesses();
  } catch (err) {
    console.error("excesses save:", err);
    setFormMessage("Ошибка сохранения. Проверьте интернет и настройки Supabase.", true);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function saveEditedExcess() {
  const id = editingExcessId;
  if (id == null) return;

  const existing = excessesRowsCache.find((r) => Number(r.id) === id);
  if (!existing) {
    setFormMessage("Запись не найдена.", true);
    return;
  }

  const rows = collectRowsFromDom();
  const row = rows[0];
  if (!row) {
    setFormMessage("Нет данных для сохранения.", true);
    return;
  }

  const amountParsed = tryParseRublesInteger(row.amountRaw);
  const hasAmount = String(row.amountRaw ?? "").trim() !== "";
  const paidTo = normRecipientSelect(row.paidTo);

  if (!hasAmount) {
    setFormMessage("Укажите сумму.", true);
    row.amountInput?.focus();
    return;
  }
  if (!amountParsed.ok || amountParsed.value == null) {
    setFormMessage(MSG_SUM_INTEGER_ONLY, true);
    if (row.amountInput) refreshRublesIntegerInputState(row.amountInput, row.amountRaw);
    row.amountInput?.focus();
    return;
  }
  if (!paidTo) {
    setFormMessage("Укажите «Кому».", true);
    row.whoSelect?.focus();
    if (row.whoSelect) refreshWhoRequiredState(row.whoSelect.closest(".excess-row"));
    return;
  }
  if (isForbiddenKassaBeznalSelection(paidTo, existing.paid_to)) {
    setFormMessage("Выбор «Касса» или «Безнал» недоступен для вашей роли.", true);
    row.whoSelect?.focus();
    return;
  }

  const saveBtn = getSaveBtn();
  if (saveBtn) saveBtn.disabled = true;

  const payload = {
    amount: amountParsed.value,
    paid_to: paidTo,
    created_by: state.currentUser?.email || null,
    created_at: new Date().toISOString(),
  };

  try {
    const result = await raceWithTimeout(
      supabaseClient
        .from("excesses")
        .update(payload)
        .eq("id", id)
        .is("deleted_at", null)
        .select(),
    );
    if (result?.error) {
      console.error("excesses update:", result.error);
      setFormMessage("Не удалось сохранить изменения.", true);
      return;
    }

    await writeExcessDeltaCalculations({
      wasEditing: true,
      oldAmount: existing.amount,
      oldPaidTo: existing.paid_to || "",
      newAmount: payload.amount,
      newPaidTo: payload.paid_to,
      client: existing.client || row.client,
    });

    const historyNext = {
      client: existing.client || row.client,
      amount: payload.amount,
      paid_to: payload.paid_to,
    };
    const historyComments = buildExcessHistoryComments(existing, historyNext, "edit");
    if (!(historyComments.length === 1 && historyComments[0] === "Сохранено без изменений")) {
      const hist = await insertExcessHistoryComments(
        id,
        historyComments,
        payload.created_by || state.currentUser?.email,
      );
      if (!hist.ok) {
        setFormMessage(
          "Изменения сохранены, но история для «Все изменения» не записалась. Выполните supabase_excess_history_table.sql в Supabase.",
          true,
        );
        await loadExcesses();
        return;
      }
    }

    resetFormToEmpty();
    setFormMessage("Изменения сохранены.");
    await loadExcesses();
  } catch (err) {
    console.error("excesses update:", err);
    setFormMessage("Ошибка сохранения. Проверьте интернет и настройки Supabase.", true);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

/** Сортировка строк излишков: клиент А→Я, при равенстве — по возрастанию даты. */
function sortExcessesRows(rows) {
  return [...rows].sort((a, b) => {
    const clientCmp = String(a?.client ?? "").localeCompare(String(b?.client ?? ""), "ru", {
      sensitivity: "base",
      numeric: true,
    });
    if (clientCmp !== 0) return clientCmp;
    const ta = a?.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b?.created_at ? new Date(b.created_at).getTime() : 0;
    const aValid = Number.isFinite(ta) ? ta : 0;
    const bValid = Number.isFinite(tb) ? tb : 0;
    if (aValid !== bValid) return aValid - bValid;
    return Number(a?.id) - Number(b?.id);
  });
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

  for (const row of sortExcessesRows(rows)) {
    const tr = document.createElement("tr");
    const author = shortLoginByEmail(row.created_by) || "—";
    const amount =
      row.amount != null && row.amount !== "" ? `${formatAmount(row.amount)}\u00A0₽` : "—";
    const paidTo = row.paid_to ? String(row.paid_to) : "";
    tr.innerHTML = `
      <td class="td-client">${escapeHtml(row.client || "")}</td>
      <td class="td-time">${escapeHtml(formatDateTime(row.created_at))}</td>
      <td class="td-author">${escapeHtml(author)}</td>
      <td class="td-money">${escapeHtml(amount)}</td>
      <td class="td-who">${escapeHtml(paidTo)}</td>
      <td class="td-actions">
        <button type="button" class="btn-icon btn-edit excess-edit-btn" data-id="${escapeHtml(String(row.id))}" title="Редактировать" aria-label="Редактировать">
          ${EXCESS_ICON_EDIT_SVG}
        </button>
        <button type="button" class="btn-icon btn-delete excess-delete-btn" data-id="${escapeHtml(String(row.id))}" title="Удалить" aria-label="Удалить">
          ${EXCESS_ICON_DELETE_SVG}
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

  const existing = excessesRowsCache.find((r) => Number(r.id) === n);

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

    if (existing) {
      await writeExcessDeltaCalculations({
        wasEditing: true,
        oldAmount: existing.amount,
        oldPaidTo: existing.paid_to || "",
        newAmount: 0,
        newPaidTo: "",
        client: existing.client || "",
      });
      await insertExcessHistoryComments(
        n,
        buildExcessHistoryComments(existing, existing, "delete"),
        existing.created_by || state.currentUser?.email,
      );
    }

    if (editingExcessId === n) {
      resetFormToEmpty();
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
        .select("id, created_at, client, amount, paid_to, created_by")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(500),
    );
    if (result?.error) {
      console.error("excesses load:", result.error);
      excessesRowsCache = [];
      renderExcessesTable([]);
      setTableMessage(
        "Не удалось загрузить излишки. Выполните supabase_excesses_table.sql и supabase_excesses_paid_to.sql в Supabase.",
      );
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
    const editBtn = e.target?.closest?.(".excess-edit-btn");
    if (editBtn) {
      startEditExcess(editBtn.dataset.id);
      return;
    }
    const deleteBtn = e.target?.closest?.(".excess-delete-btn");
    if (!deleteBtn) return;
    void deleteExcess(deleteBtn.dataset.id);
  });
}
