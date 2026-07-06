import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import { formatOrderIdTypeChip, formatTaskDateRu, formatTaskAuthorShort } from "./format.js";
import { viewOrder } from "./orders.js";

const ORDER_TOKEN_RE = /\[\[order:(\d+)\]\]/g;
const SUGGEST_DEBOUNCE_MS = 120;
const UNREAD_POLL_MS = 60_000;

let usersCache = null;
let usersCachePromise = null;
let unreadPollTimer = null;
let composerRecipient = null;

function escapeHtml(s) {
  if (s == null) return "";
  const div = document.createElement("div");
  div.textContent = String(s);
  return div.innerHTML;
}

function getCurrentUserId() {
  return state.currentUser?.id || null;
}

function getCurrentUserEmail() {
  const u = state.currentUser;
  if (!u) return "";
  return (u.email || "").trim();
}

async function loadUsersDirectory() {
  if (usersCache) return usersCache;
  if (usersCachePromise) return usersCachePromise;

  usersCachePromise = (async () => {
    const { data, error } = await supabaseClient
      .from("profiles")
      .select("id, email, role")
      .not("email", "is", null)
      .order("email");

    if (error) {
      console.error("Ошибка загрузки списка пользователей:", error);
      usersCache = [];
      return usersCache;
    }

    usersCache = (data || [])
      .map((row) => ({
        id: row.id,
        email: (row.email || "").trim(),
        role: row.role || "",
      }))
      .filter((u) => u.id && u.email);
    return usersCache;
  })();

  return usersCachePromise;
}

function renderMessageBodyHtml(body) {
  const raw = String(body || "");
  const parts = [];
  let lastIndex = 0;
  const re = /\[\[order:(\d+)\]\]/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    if (m.index > lastIndex) {
      parts.push({ type: "text", value: raw.slice(lastIndex, m.index) });
    }
    parts.push({ type: "order", orderId: m[1] });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < raw.length) {
    parts.push({ type: "text", value: raw.slice(lastIndex) });
  }

  return parts
    .map((part) => {
      if (part.type === "order") {
        const order = state.allOrders?.find((o) => Number(o.id) === Number(part.orderId));
        const chip = formatOrderIdTypeChip(part.orderId, order?.order_type);
        return `<a href="#" class="message-order-link" data-order-id="${escapeHtml(part.orderId)}">${escapeHtml(chip)}</a>`;
      }
      let text = escapeHtml(part.value);
      text = text.replace(/@([\w.@+-]+)/g, '<span class="message-mention">@$1</span>');
      return text;
    })
    .join("");
}

function messageItemClass(row) {
  const uid = getCurrentUserId();
  if (row.sender_id === uid) return "message-item message-item--out";
  return "message-item message-item--in";
}

function renderMessageItem(row) {
  const uid = getCurrentUserId();
  const isOut = row.sender_id === uid;
  const peerEmail = isOut ? row.recipient_email : row.sender_email;
  const unread = !isOut && !row.read_at;
  return `
    <article class="${messageItemClass(row)}${unread ? " message-item--unread" : ""}" data-message-id="${row.id}">
      <header class="message-item-header">
        <span class="message-item-peer">${escapeHtml(isOut ? "→ " : "← ")}${escapeHtml(formatTaskAuthorShort(peerEmail))}</span>
        <time class="message-item-time">${escapeHtml(formatTaskDateRu(row.created_at))}</time>
      </header>
      <div class="message-item-body">${renderMessageBodyHtml(row.body)}</div>
    </article>
  `;
}

export async function loadMessages() {
  const feed = document.getElementById("messagesFeed");
  const msg = document.getElementById("messagesPageMessage");
  if (!feed) return;

  const uid = getCurrentUserId();
  if (!uid) return;

  if (msg) {
    msg.textContent = "";
    msg.classList.remove("messages-page-message--error");
  }

  const { data, error } = await supabaseClient
    .from("user_messages")
    .select("id, sender_id, recipient_id, sender_email, recipient_email, body, created_at, read_at")
    .or(`sender_id.eq.${uid},recipient_id.eq.${uid}`)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Ошибка загрузки сообщений:", error);
    if (msg) {
      msg.textContent = "Ошибка загрузки сообщений. Проверьте, что таблица user_messages создана в Supabase.";
      msg.classList.add("messages-page-message--error");
    }
    feed.innerHTML = "";
    return;
  }

  const rows = data || [];
  feed.innerHTML = rows.length
    ? rows.map(renderMessageItem).join("")
    : '<p class="messages-empty">Пока нет сообщений. Напишите первое: укажите получателя через @ и текст.</p>';

  feed.scrollTop = feed.scrollHeight;

  await markIncomingMessagesRead(rows);
  void refreshMessagesUnreadBadge();
}

async function markIncomingMessagesRead(rows) {
  const uid = getCurrentUserId();
  if (!uid) return;

  const unreadIds = (rows || [])
    .filter((r) => r.recipient_id === uid && !r.read_at)
    .map((r) => r.id);
  if (unreadIds.length === 0) return;

  const now = new Date().toISOString();
  const { error } = await supabaseClient
    .from("user_messages")
    .update({ read_at: now })
    .in("id", unreadIds)
    .eq("recipient_id", uid);

  if (error) {
    console.error("Ошибка отметки прочитанных:", error);
  }
}

export async function refreshMessagesUnreadBadge() {
  const badge = document.getElementById("messagesUnreadBadge");
  const btn = document.getElementById("messagesNavBtn");
  if (!badge || !btn) return;

  const uid = getCurrentUserId();
  if (!uid) {
    badge.hidden = true;
    return;
  }

  const { count, error } = await supabaseClient
    .from("user_messages")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", uid)
    .is("read_at", null);

  if (error) {
    console.warn("Не удалось получить число непрочитанных:", error);
    badge.hidden = true;
    return;
  }

  const n = count || 0;
  if (n > 0) {
    badge.textContent = n > 99 ? "99+" : String(n);
    badge.hidden = false;
    btn.classList.add("messages-nav-btn--has-unread");
  } else {
    badge.hidden = true;
    btn.classList.remove("messages-nav-btn--has-unread");
  }
}

function startUnreadPolling() {
  if (unreadPollTimer) return;
  void refreshMessagesUnreadBadge();
  unreadPollTimer = window.setInterval(() => {
    void refreshMessagesUnreadBadge();
  }, UNREAD_POLL_MS);
}

function getTextareaCaret(el) {
  return { start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 };
}

function setTextareaCaret(el, pos) {
  el.focus();
  el.setSelectionRange(pos, pos);
}

function getTriggerContext(text, caretPos) {
  const before = text.slice(0, caretPos);
  const atMatch = before.match(/@([\w.@+-]*)$/);
  if (atMatch) {
    return { type: "user", query: atMatch[1], start: caretPos - atMatch[0].length };
  }
  const ampMatch = before.match(/&(\d*)$/);
  if (ampMatch) {
    return { type: "order", query: ampMatch[1], start: caretPos - ampMatch[0].length };
  }
  return null;
}

function filterUsers(query) {
  const q = (query || "").trim().toLowerCase();
  const list = usersCache || [];
  if (!q) return list.slice(0, 15);
  return list
    .filter((u) => u.email.toLowerCase().includes(q))
    .slice(0, 15);
}

function filterOrders(query) {
  const q = (query || "").trim();
  const orders = state.allOrders || [];
  const out = [];
  for (const o of orders) {
    const idStr = String(o.id ?? "");
    const chip = formatOrderIdTypeChip(o.id, o.order_type);
    const client = (o.client || "").trim();
    if (!q) {
      out.push({ id: o.id, chip, client });
    } else if (idStr.includes(q) || chip.toLowerCase().includes(q.toLowerCase()) || client.toLowerCase().includes(q.toLowerCase())) {
      out.push({ id: o.id, chip, client });
    }
    if (out.length >= 15) break;
  }
  return out;
}

function hideSuggestions() {
  const list = document.getElementById("messagesComposerSuggestions");
  if (list) {
    list.hidden = true;
    list.innerHTML = "";
  }
}

function showSuggestions(items, onPick) {
  const list = document.getElementById("messagesComposerSuggestions");
  if (!list) return;
  if (!items.length) {
    hideSuggestions();
    return;
  }

  list.innerHTML = items
    .map(
      (item, idx) => `
    <li role="option" data-index="${idx}" aria-selected="${idx === 0 ? "true" : "false"}">
      <span class="messages-suggestion-text">${escapeHtml(item.label)}</span>
      ${item.hint ? `<span class="messages-suggestion-hint">${escapeHtml(item.hint)}</span>` : ""}
    </li>
  `,
    )
    .join("");
  list.hidden = false;

  list.querySelectorAll("li").forEach((li) => {
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const idx = Number(li.dataset.index);
      const picked = items[idx];
      if (picked) onPick(picked);
    });
  });
}

function applyUserPick(input, ctx, user) {
  const text = input.value;
  const before = text.slice(0, ctx.start);
  const after = text.slice(getTextareaCaret(input).end);
  const insert = `@${user.email} `;
  input.value = before + insert + after;
  const pos = before.length + insert.length;
  setTextareaCaret(input, pos);
  composerRecipient = { id: user.id, email: user.email };
  hideSuggestions();
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function applyOrderPick(input, ctx, order) {
  const text = input.value;
  const before = text.slice(0, ctx.start);
  const after = text.slice(getTextareaCaret(input).end);
  const token = `[[order:${order.id}]]`;
  const insert = `${token} `;
  input.value = before + insert + after;
  const pos = before.length + insert.length;
  setTextareaCaret(input, pos);
  hideSuggestions();
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function updateComposerSuggestions(input) {
  const caret = getTextareaCaret(input);
  const ctx = getTriggerContext(input.value, caret.start);
  if (!ctx) {
    hideSuggestions();
    return;
  }

  if (ctx.type === "user") {
    const users = filterUsers(ctx.query);
    const items = users.map((u) => ({
      label: u.email,
      hint: u.role || "",
      user: u,
    }));
    showSuggestions(items, (item) => applyUserPick(input, ctx, item.user));
    return;
  }

  if (ctx.type === "order") {
    const orders = filterOrders(ctx.query);
    const items = orders.map((o) => ({
      label: o.chip,
      hint: o.client || "",
      order: o,
    }));
    showSuggestions(items, (item) => applyOrderPick(input, ctx, item.order));
  }
}

function parseRecipientFromText(text) {
  const m = text.match(/@([\w.@+-]+)/);
  if (!m) return null;
  const email = m[1].toLowerCase();
  const user = (usersCache || []).find((u) => u.email.toLowerCase() === email);
  return user ? { id: user.id, email: user.email } : null;
}

async function sendMessage() {
  const input = document.getElementById("messagesComposerInput");
  const msg = document.getElementById("messagesPageMessage");
  const sendBtn = document.getElementById("messagesSendBtn");
  if (!input) return;

  const body = input.value.trim();
  if (!body) return;

  const uid = getCurrentUserId();
  if (!uid) return;

  await loadUsersDirectory();

  const recipient = composerRecipient || parseRecipientFromText(body);
  if (!recipient) {
    if (msg) {
      msg.textContent = "Укажите получателя через @ (выберите из списка).";
      msg.classList.add("messages-page-message--error");
    }
    return;
  }

  if (recipient.id === uid) {
    if (msg) {
      msg.textContent = "Нельзя отправить сообщение самому себе.";
      msg.classList.add("messages-page-message--error");
    }
    return;
  }

  if (sendBtn) sendBtn.disabled = true;
  if (msg) {
    msg.textContent = "";
    msg.classList.remove("messages-page-message--error");
  }

  const senderEmail = getCurrentUserEmail();
  const { error } = await supabaseClient.from("user_messages").insert([
    {
      sender_id: uid,
      recipient_id: recipient.id,
      sender_email: senderEmail,
      recipient_email: recipient.email,
      body,
    },
  ]);

  if (sendBtn) sendBtn.disabled = false;

  if (error) {
    console.error("Ошибка отправки сообщения:", error);
    if (msg) {
      msg.textContent = "Не удалось отправить сообщение.";
      msg.classList.add("messages-page-message--error");
    }
    return;
  }

  input.value = "";
  composerRecipient = null;
  hideSuggestions();
  await loadMessages();
}

function onFeedClick(e) {
  const link = e.target.closest(".message-order-link");
  if (!link) return;
  e.preventDefault();
  const raw = link.getAttribute("data-order-id");
  const orderId = raw != null ? Number(raw) : NaN;
  if (!Number.isFinite(orderId)) return;
  void viewOrder(orderId);
}

export function initMessagesSection() {
  const navBtn = document.getElementById("messagesNavBtn");
  const sendBtn = document.getElementById("messagesSendBtn");
  const input = document.getElementById("messagesComposerInput");
  const feed = document.getElementById("messagesFeed");

  if (navBtn) {
    navBtn.addEventListener("click", () => {
      import("./section-nav.js").then((m) => m.switchSection("messages"));
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener("click", () => void sendMessage());
  }

  const msgEl = document.getElementById("messagesPageMessage");
  if (feed) {
    feed.addEventListener("click", onFeedClick);
  }

  if (input) {
    let debounceTimer = null;
    input.addEventListener("input", () => {
      if (msgEl) msgEl.classList.remove("messages-page-message--error");
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void loadUsersDirectory().then(() => updateComposerSuggestions(input));
      }, SUGGEST_DEBOUNCE_MS);
    });

    input.addEventListener("keydown", (e) => {
      const list = document.getElementById("messagesComposerSuggestions");
      if (!list || list.hidden) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          void sendMessage();
        }
        return;
      }

      const items = [...list.querySelectorAll("li")];
      let idx = items.findIndex((li) => li.getAttribute("aria-selected") === "true");
      if (e.key === "ArrowDown") {
        e.preventDefault();
        idx = Math.min(idx + 1, items.length - 1);
        items.forEach((li, i) => li.setAttribute("aria-selected", i === idx ? "true" : "false"));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        idx = Math.max(idx - 1, 0);
        items.forEach((li, i) => li.setAttribute("aria-selected", i === idx ? "true" : "false"));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const selected = items[idx];
        if (selected) selected.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      } else if (e.key === "Escape") {
        hideSuggestions();
      }
    });

    input.addEventListener("blur", () => {
      setTimeout(hideSuggestions, 150);
    });
  }

  void loadUsersDirectory();
  startUnreadPolling();
}

export { ORDER_TOKEN_RE };
