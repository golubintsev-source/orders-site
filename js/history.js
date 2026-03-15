import { supabaseClient } from "./config.js";
import { checkAuth } from "./auth.js";

const params = new URLSearchParams(window.location.search);
const orderId = params.get("order_id");

let currentUser = null;

async function loadHistory() {
  if (!orderId) return;

  const { data, error } = await supabaseClient
    .from("order_history")
    .select("created_at, user_email, comment")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  const tbody = document.querySelector("#historyTable tbody");
  const msgEl = document.getElementById("historyMessage");
  tbody.innerHTML = "";

  if (error) {
    console.error("Ошибка загрузки истории:", error);
    msgEl.textContent = "Ошибка загрузки истории.";
    return;
  }

  if (!data || data.length === 0) {
    msgEl.textContent = "Записей пока нет.";
    return;
  }

  msgEl.textContent = "";
  data.forEach((row) => {
    const createdAt = row.created_at ? formatDateTime(row.created_at) : "";
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(createdAt)}</td><td>${escapeHtml(row.user_email || "")}</td><td>${escapeHtml(row.comment || "")}</td>`;
    tbody.appendChild(tr);
  });
}

async function addComment() {
  const commentEl = document.getElementById("historyComment");
  const comment = (commentEl?.value || "").trim();
  if (!comment) return;
  if (!orderId || !currentUser?.email) return;

  const { error } = await supabaseClient.from("order_history").insert([
    { order_id: Number(orderId), user_email: currentUser.email, comment },
  ]);

  if (error) {
    console.error("Ошибка добавления комментария:", error);
    document.getElementById("historyMessage").textContent = "Ошибка при добавлении.";
    return;
  }

  commentEl.value = "";
  document.getElementById("historyMessage").textContent = "";
  await loadHistory();
}

async function init() {
  const user = await checkAuth();
  if (!user) return;
  currentUser = user;

  if (!orderId) {
    document.getElementById("historyTitle").textContent = "История заказа";
    document.getElementById("historyMessage").textContent = "Не указан номер заказа.";
    return;
  }

  document.getElementById("historyTitle").textContent = `История заказа #${orderId}`;

  document.getElementById("backToOrdersBtn")?.addEventListener("click", () => {
    window.location.href = "index.html#all";
  });

  document.getElementById("historyCommentForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    addComment();
  });

  await loadHistory();
}

function formatDateTime(iso) {
  try {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

init();
