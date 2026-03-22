import { supabaseClient } from "./config.js";
import { checkAuth, loadProfile, logout } from "./auth.js";
import { isOrderHiddenFromUserLite } from "./roles.js";
import { formatOrderIdTypeChip, formatTaskDateRu, formatTaskAuthorShort } from "./format.js";
import {
  initSectionNavDropdown,
  setStandaloneSectionNavLabel,
  closeOrdersSearchPanel,
  closeSectionNavDropdown,
  refreshSectionNavAfterProfile,
} from "./section-nav.js";

const params = new URLSearchParams(window.location.search);
const orderId = params.get("order_id");

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s == null ? "" : String(s);
  return div.innerHTML;
}

function setHistorySectionLabel(orderType) {
  if (!orderId) {
    setStandaloneSectionNavLabel("История");
    return;
  }
  const chip = formatOrderIdTypeChip(orderId, orderType);
  const text = chip ? `История ${chip}` : `История #${orderId}`;
  setStandaloneSectionNavLabel(text);
}

function wireHistorySearchAndLogout() {
  const ordersSearchOpenBtn = document.getElementById("ordersSearchOpenBtn");
  const ordersSearchPopupInput = document.getElementById("ordersSearchPopupInput");
  const ordersSearchFindBtn = document.getElementById("ordersSearchFindBtn");
  const ordersSearchCloseBtn = document.getElementById("ordersSearchCloseBtn");
  const ordersSearchPanel = document.getElementById("ordersSearchDropdownPanel");

  function goToOrdersWithSearch(query) {
    sessionStorage.setItem("pendingOrdersSearch", query.trim());
    window.location.href = "index.html#all";
  }

  function openOrdersSearchDropdown() {
    if (!ordersSearchOpenBtn || !ordersSearchPanel) return;
    closeSectionNavDropdown();
    ordersSearchPanel.hidden = false;
    ordersSearchOpenBtn.setAttribute("aria-expanded", "true");
    ordersSearchOpenBtn.classList.add("section-nav-search-btn--open");
    queueMicrotask(() => ordersSearchPopupInput?.focus());
  }

  function toggleOrdersSearchDropdown() {
    if (!ordersSearchPanel || !ordersSearchOpenBtn) return;
    if (ordersSearchPanel.hidden) openOrdersSearchDropdown();
    else closeOrdersSearchPanel();
  }

  if (ordersSearchOpenBtn) {
    ordersSearchOpenBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleOrdersSearchDropdown();
    });
  }
  if (ordersSearchFindBtn) {
    ordersSearchFindBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const q = (ordersSearchPopupInput?.value || "").trim();
      closeOrdersSearchPanel();
      goToOrdersWithSearch(q);
    });
  }
  if (ordersSearchCloseBtn) {
    ordersSearchCloseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (ordersSearchPopupInput) ordersSearchPopupInput.value = "";
      closeOrdersSearchPanel();
    });
  }
  if (ordersSearchPopupInput) {
    ordersSearchPopupInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const q = (ordersSearchPopupInput.value || "").trim();
        closeOrdersSearchPanel();
        goToOrdersWithSearch(q);
      }
    });
  }

  document.getElementById("logoutBtn")?.addEventListener("click", () => {
    void logout();
  });

  document.getElementById("backToOrdersBtn")?.addEventListener("click", () => {
    window.location.href = "index.html#all";
  });
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

async function init() {
  const user = await checkAuth();
  if (!user) return;
  await loadProfile();
  refreshSectionNavAfterProfile();

  initSectionNavDropdown({
    onSectionItemSelect: (id) => {
      window.location.href = `index.html#${id}`;
    },
  });
  setStandaloneSectionNavLabel("История");
  wireHistorySearchAndLogout();

  if (!orderId) {
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
    setHistorySectionLabel(orderRow?.order_type);
    document.getElementById("historyMessage").textContent = "Нет доступа к заказам типа «Магазин».";
    return;
  }

  setHistorySectionLabel(orderRow?.order_type);

  await loadHistory();
}

init();
