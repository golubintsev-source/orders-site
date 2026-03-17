import { supabaseClient } from "./config.js";
import { checkAuth } from "./auth.js";
import { formatAmount } from "./format.js";

let editingId = null;
let editingCreatedAt = null;

function formatDateShort(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const months = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
    return `${d.getDate()} ${months[d.getMonth()]}`;
  } catch {
    return iso;
  }
}

function toDateTimeLocal(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

function escapeHtml(s) {
  if (s == null) return "";
  const div = document.createElement("div");
  div.textContent = String(s);
  return div.innerHTML;
}

function setMessage(text, isError) {
  const el = document.getElementById("calculationsMessage");
  if (el) {
    el.textContent = text || "";
    el.style.color = isError ? "#d32f2f" : "";
  }
}

export async function loadCalculations() {
  const { data, error } = await supabaseClient
    .from("calculations")
    .select("id, created_at, from_place, to_place, amount, comment")
    .order("created_at", { ascending: false });

  const tbody = document.querySelector("#calculationsTable tbody");
  tbody.innerHTML = "";

  if (error) {
    console.error("Ошибка загрузки расчетов:", error);
    setMessage("Ошибка загрузки данных.", true);
    return;
  }

  setMessage("");
  if (!data || data.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = "<td colspan=\"6\">Записей пока нет.</td>";
    tbody.appendChild(tr);
    return;
  }

  data.forEach((row) => {
    const comment = row.comment ?? "";
    const escapedComment = escapeHtml(comment);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(formatDateShort(row.created_at))}</td>
      <td>${escapeHtml(row.from_place)}</td>
      <td>${escapeHtml(row.to_place)}</td>
      <td>${escapeHtml(formatAmount(row.amount))}</td>
      <td class="td-calc-comment" title="${escapedComment}">${escapedComment}</td>
      <td class="td-actions">
        <button type="button" class="btn-icon btn-edit" data-id="${row.id}" title="Редактировать">✎</button>
        <button type="button" class="btn-icon btn-delete" data-id="${row.id}" title="Удалить">✕</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".btn-edit").forEach((btn) => {
    btn.addEventListener("click", () => startEdit(Number(btn.dataset.id)));
  });
  tbody.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", () => deleteRow(Number(btn.dataset.id)));
  });
}

function getFormValues() {
  const fromEl = document.getElementById("calcFrom");
  const toEl = document.getElementById("calcTo");
  const amountEl = document.getElementById("calcAmount");
  const commentEl = document.getElementById("calcComment");
  const payload = {
    from_place: fromEl?.value?.trim() || null,
    to_place: toEl?.value?.trim() || null,
    amount: amountEl?.value !== "" ? Number(amountEl.value) : null,
    comment: commentEl?.value?.trim() || null,
  };
  if (editingId && editingCreatedAt) {
    payload.created_at = editingCreatedAt;
  }
  return payload;
}

function setFormValues(row) {
  const fromEl = document.getElementById("calcFrom");
  const toEl = document.getElementById("calcTo");
  const amountEl = document.getElementById("calcAmount");
  const commentEl = document.getElementById("calcComment");
  if (fromEl) fromEl.value = row.from_place || "";
  if (toEl) toEl.value = row.to_place || "";
  if (amountEl) amountEl.value = row.amount != null ? row.amount : "";
  if (commentEl) commentEl.value = row.comment || "";
}

function resetForm() {
  editingId = null;
  editingCreatedAt = null;
  const fromEl = document.getElementById("calcFrom");
  const toEl = document.getElementById("calcTo");
  const amountEl = document.getElementById("calcAmount");
  const commentEl = document.getElementById("calcComment");
  if (fromEl) fromEl.value = "";
  if (toEl) toEl.value = "";
  if (amountEl) amountEl.value = "";
  if (commentEl) commentEl.value = "";
  const submitBtn = document.getElementById("calcSubmitBtn");
  if (submitBtn) submitBtn.textContent = "Добавить";
}

function startEdit(id) {
  editingId = id;
  editingCreatedAt = null;
  document.getElementById("calcSubmitBtn").textContent = "Сохранить";
  supabaseClient
    .from("calculations")
    .select("id, created_at, from_place, to_place, amount, comment")
    .eq("id", id)
    .single()
    .then(({ data, error }) => {
      if (error || !data) {
        setMessage("Ошибка загрузки записи.", true);
        return;
      }
      editingCreatedAt = data.created_at;
      setFormValues(data);
    });
}

async function submitForm(e) {
  e.preventDefault();
  const payload = getFormValues();

  if (editingId) {
    const { error } = await supabaseClient
      .from("calculations")
      .update(payload)
      .eq("id", editingId);
    if (error) {
      console.error("Ошибка обновления:", error);
      setMessage("Ошибка при сохранении.", true);
      return;
    }
    setMessage("Запись обновлена.");
    resetForm();
  } else {
    const insertPayload = { ...payload, created_at: new Date().toISOString() };
    const { error } = await supabaseClient.from("calculations").insert([insertPayload]);
    if (error) {
      console.error("Ошибка добавления:", error);
      setMessage("Ошибка при добавлении.", true);
      return;
    }
    setMessage("");
    resetForm();
  }
  await loadCalculations();
}

async function deleteRow(id) {
  if (!confirm("Удалить эту запись?")) return;
  const { error } = await supabaseClient.from("calculations").delete().eq("id", id);
  if (error) {
    console.error("Ошибка удаления:", error);
    setMessage("Ошибка при удалении.", true);
    return;
  }
  if (editingId === id) resetForm();
  setMessage("");
  await loadCalculations();
}

function setupCalculationsForm() {
  const form = document.getElementById("calculationsForm");
  if (form) form.addEventListener("submit", submitForm);
}

export async function initCalculationsSection() {
  setupCalculationsForm();
  await loadCalculations();
}

async function init() {
  const user = await checkAuth();
  if (!user) return;

  document.getElementById("backToOrdersBtn")?.addEventListener("click", () => {
    window.location.href = "index.html";
  });

  setupCalculationsForm();
  await loadCalculations();
}

if (document.getElementById("backToOrdersBtn")) {
  init();
}
