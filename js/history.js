import { supabaseClient } from "./config.js";
import { checkAuth, loadProfile } from "./auth.js";
import { isOrderHiddenFromUserLite } from "./roles.js";
import { formatOrderIdTypeChip, formatTaskDateRu, formatTaskAuthorShort } from "./format.js";

const params = new URLSearchParams(window.location.search);
const orderId = params.get("order_id");

let currentUser = null;

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s == null ? "" : String(s);
  return div.innerHTML;
}

function setHistoryTitle(orderType) {
  const el = document.getElementById("historyPageTitle");
  if (!el) return;
  if (!orderId) {
    el.textContent = "";
    return;
  }
  const chip = formatOrderIdTypeChip(orderId, orderType);
  el.textContent = chip ? `История заказа ${chip}` : `История заказа #${orderId}`;
}

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
    const createdAt = row.created_at ? formatTaskDateRu(row.created_at) : "—";
    const author = formatTaskAuthorShort(row.user_email || "");
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(createdAt)}</td><td>${escapeHtml(author)}</td><td class="order-tasks-text-cell">${escapeHtml(row.comment || "")}</td>`;
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
  await loadProfile();

  if (!orderId) {
    setHistoryTitle(null);
    document.getElementById("historyMessage").textContent = "Не указан номер заказа.";
    return;
  }

  const { data: orderRow, error: orderFetchErr } = await supabaseClient
    .from("orders")
    .select("order_type")
    .eq("id", orderId)
    .maybeSingle();

  if (orderFetchErr) {
    console.error("Ошибка загрузки заказа:", orderFetchErr);
    document.getElementById("historyMessage").textContent = "Не удалось загрузить заказ.";
    return;
  }

  if (isOrderHiddenFromUserLite(orderRow)) {
    setHistoryTitle(orderRow?.order_type);
    document.getElementById("historyMessage").textContent = "Нет доступа к заказам типа «Магазин».";
    const form = document.getElementById("historyCommentForm");
    if (form) form.hidden = true;
    return;
  }

  setHistoryTitle(orderRow?.order_type);

  document.getElementById("backToOrdersBtn")?.addEventListener("click", () => {
    window.location.href = "index.html#all";
  });

  document.getElementById("historyCommentForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    addComment();
  });

  await loadHistory();
}

init();
