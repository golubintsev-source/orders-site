import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import { formatOrderIdTypeChip, formatTaskDateRu } from "./format.js";
import { displayNameByEmail } from "./user-names.js";
import { buildOrderPickerRowHtml, viewOrder } from "./orders.js";
import { isOrderHiddenForCurrentRole } from "./roles.js";

const ORDER_TOKEN_RE = /\[\[order:(\d+)\]\]/g;
const SUGGEST_DEBOUNCE_MS = 120;
const UNREAD_POLL_MS = 60_000;
const FEED_POLL_MS = 15_000;
const CHAT_LIST_POLL_MS = 20_000;
/** Специальный peer id для общего чата (все переписки). */
const CHAT_PEER_ALL = "all";

let usersCache = null;
let usersCachePromise = null;
let unreadPollTimer = null;
let feedPollTimer = null;
let chatListPollTimer = null;
let lastFeedMessageAt = null;
let lastMessagePeerId = null;
/** @type {"list" | "dialog"} */
let messagesView = "list";
/** @type {string | null} null на списке; CHAT_PEER_ALL или uuid в диалоге */
let activePeerId = null;
/** @type {Map<string, { id: string, email: string }>} */
let composerRecipients = new Map();
let activePicker = null;
/** null = unknown, true/false after first probe */
let deliveredAtSupported = null;

const MESSAGE_SELECT_WITH_DELIVERED =
  "id, sender_id, recipient_id, sender_email, recipient_email, body, created_at, read_at, delivered_at";
const MESSAGE_SELECT_BASIC =
  "id, sender_id, recipient_id, sender_email, recipient_email, body, created_at, read_at";

function messageSelectColumns() {
  return deliveredAtSupported === false ? MESSAGE_SELECT_BASIC : MESSAGE_SELECT_WITH_DELIVERED;
}

function noteDeliveredAtSupport(error) {
  if (!error) {
    deliveredAtSupported = true;
    return false;
  }
  const msg = `${error.message || ""} ${error.details || ""} ${error.hint || ""}`.toLowerCase();
  if (msg.includes("delivered_at") || error.code === "PGRST204" || error.code === "42703") {
    deliveredAtSupported = false;
    return true;
  }
  return false;
}

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

function updateLastMessagePeerId(rows) {
  if (!rows?.length) {
    lastMessagePeerId = null;
    return;
  }
  const uid = getCurrentUserId();
  const last = rows[rows.length - 1];
  lastMessagePeerId = String(last.sender_id) === String(uid) ? last.recipient_id : last.sender_id;
}

function isGeneralChat() {
  return activePeerId === CHAT_PEER_ALL;
}

function isPeerChat() {
  return Boolean(activePeerId) && activePeerId !== CHAT_PEER_ALL;
}

function messageBelongsToPeer(row, peerId, uid) {
  if (!peerId || peerId === CHAT_PEER_ALL) return true;
  const me = String(uid);
  const peer = String(peerId);
  const sid = String(row.sender_id);
  const rid = String(row.recipient_id);
  return (sid === me && rid === peer) || (sid === peer && rid === me);
}

function peerIdFromMessage(row, uid) {
  return String(row.sender_id) === String(uid) ? String(row.recipient_id) : String(row.sender_id);
}

/** Время в списке чатов: HH:MM сегодня, иначе число дня месяца. */
function formatChatListTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (d >= startOfToday) {
    const h = d.getHours();
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${h}:${min}`;
  }
  return String(d.getDate());
}

function previewMessageBody(body, recipientEmail) {
  const stripped = stripRecipientMentionFromBody(body, recipientEmail);
  return String(stripped || "")
    .replace(/\[\[order:(\d+)\]\]/g, (_, id) => `#${id}`)
    .replace(/\s+/g, " ")
    .trim();
}

function avatarInitial(name) {
  const s = String(name || "").trim();
  return s ? s.charAt(0).toUpperCase() : "?";
}

function avatarHue(seed) {
  const str = String(seed || "");
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
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

function stripRecipientMentionFromBody(body, recipientEmail) {
  const text = String(body || "");
  const email = (recipientEmail || "").trim();
  if (!text || !email) return text.trim();
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`@${escaped}\\s*`, "gi"), "").trim();
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
  if (String(row.sender_id) === String(uid)) return "message-item message-item--out";
  return "message-item message-item--in";
}

function messageDeliveryState(row, isOut) {
  const read = Boolean(row.read_at);
  const delivered = Boolean(row.delivered_at) || read;
  if (!isOut) {
    return { read, delivered, unread: !read };
  }
  if (read) return { read: true, delivered: true, unread: false, status: "read" };
  if (delivered) return { read: false, delivered: true, unread: true, status: "delivered" };
  return { read: false, delivered: false, unread: true, status: "sent" };
}

const TICK_SVG_SINGLE = `<svg class="message-ticks-icon" viewBox="0 0 12 11" aria-hidden="true" focusable="false"><path d="M1.2 5.8 4.4 9.1 10.8 1.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const TICK_SVG_DOUBLE = `<svg class="message-ticks-icon message-ticks-icon--double" viewBox="0 0 18 11" aria-hidden="true" focusable="false"><path d="M1.2 5.8 4.4 9.1 10.8 1.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.6 5.8 9.8 9.1 16.2 1.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function ticksLabel(state) {
  if (state.read) return "Прочитано";
  if (state.delivered) return "Доставлено";
  return "Отправлено";
}

function renderOutgoingTicksHtml(state) {
  const status = state.status || (state.read ? "read" : state.delivered ? "delivered" : "sent");
  const icon = status === "sent" ? TICK_SVG_SINGLE : TICK_SVG_DOUBLE;
  return `<span class="message-item-ticks message-item-ticks--${status}" title="${escapeHtml(ticksLabel(state))}" aria-label="${escapeHtml(ticksLabel(state))}">${icon}</span>`;
}

function applyOutgoingStatusToElement(el, { delivered, read }) {
  if (!el) return;
  const status = read ? "read" : delivered ? "delivered" : "sent";
  el.dataset.deliveryStatus = status;
  const ticks = el.querySelector(".message-item-ticks");
  if (!ticks) return;
  ticks.classList.remove("message-item-ticks--sent", "message-item-ticks--delivered", "message-item-ticks--read");
  ticks.classList.add(`message-item-ticks--${status}`);
  const label = ticksLabel({ read, delivered });
  ticks.setAttribute("title", label);
  ticks.setAttribute("aria-label", label);
  ticks.innerHTML = status === "sent" ? TICK_SVG_SINGLE : TICK_SVG_DOUBLE;
}

function renderMessageItem(row) {
  const uid = getCurrentUserId();
  const isOut = String(row.sender_id) === String(uid);
  const peerEmail = isOut ? row.recipient_email : row.sender_email;
  const peerName = displayNameByEmail(peerEmail) || peerEmail || "—";
  const showPeer = isGeneralChat();
  const peerLabel = isOut ? peerName : `от ${peerName}`;
  const state = messageDeliveryState(row, isOut);
  const bodyForDisplay = stripRecipientMentionFromBody(row.body, row.recipient_email);
  const statusAttr = isOut ? ` data-delivery-status="${state.status}"` : "";
  const timeHtml = `<time class="message-item-time">${escapeHtml(formatTaskDateRu(row.created_at))}</time>`;
  const metaTrailing = isOut ? `${renderOutgoingTicksHtml(state)}${timeHtml}` : timeHtml;
  const headerHtml = showPeer
    ? `<header class="message-item-header">
        <span class="message-item-peer">${escapeHtml(peerLabel)}</span>
        <span class="message-item-meta">${metaTrailing}</span>
      </header>`
    : `<header class="message-item-header message-item-header--compact">
        <span class="message-item-meta">${metaTrailing}</span>
      </header>`;
  return `
    <article class="${messageItemClass(row)}" data-message-id="${row.id}"${statusAttr}>
      ${headerHtml}
      <div class="message-item-body">${renderMessageBodyHtml(bodyForDisplay)}</div>
    </article>
  `;
}

async function fetchAllUserMessages() {
  const uid = getCurrentUserId();
  if (!uid) return { rows: [], error: null };

  let { data, error } = await supabaseClient
    .from("user_messages")
    .select(messageSelectColumns())
    .or(`sender_id.eq.${uid},recipient_id.eq.${uid}`)
    .order("created_at", { ascending: true });

  if (error && noteDeliveredAtSupport(error) && deliveredAtSupported === false) {
    ({ data, error } = await supabaseClient
      .from("user_messages")
      .select(MESSAGE_SELECT_BASIC)
      .or(`sender_id.eq.${uid},recipient_id.eq.${uid}`)
      .order("created_at", { ascending: true }));
  } else if (!error) {
    deliveredAtSupported = deliveredAtSupported !== false;
  }

  return { rows: data || [], error };
}

function buildChatListEntries(users, rows) {
  const uid = getCurrentUserId();
  const byPeer = new Map();

  for (const row of rows) {
    const peerId = peerIdFromMessage(row, uid);
    if (!peerId) continue;
    let bucket = byPeer.get(peerId);
    if (!bucket) {
      bucket = { messages: [], last: null };
      byPeer.set(peerId, bucket);
    }
    bucket.messages.push(row);
    if (!bucket.last || row.created_at >= bucket.last.created_at) {
      bucket.last = row;
    }
  }

  const others = (users || []).filter((u) => String(u.id) !== String(uid));
  const userEntries = others.map((user) => {
    const bucket = byPeer.get(String(user.id));
    const last = bucket?.last || null;
    const count = bucket?.messages?.length || 0;
    const name = displayNameByEmail(user.email) || user.email || "—";
    return {
      peerId: String(user.id),
      kind: "user",
      name,
      email: user.email,
      count,
      last,
      sortAt: last?.created_at || "",
    };
  });

  userEntries.sort((a, b) => {
    if (a.sortAt && b.sortAt) return a.sortAt < b.sortAt ? 1 : a.sortAt > b.sortAt ? -1 : 0;
    if (a.sortAt) return -1;
    if (b.sortAt) return 1;
    return a.name.localeCompare(b.name, "ru");
  });

  const generalLast = rows.length ? rows[rows.length - 1] : null;
  const general = {
    peerId: CHAT_PEER_ALL,
    kind: "general",
    name: "Общий чат",
    email: "",
    count: rows.length,
    last: generalLast,
    sortAt: generalLast?.created_at || "",
  };

  return [general, ...userEntries];
}

function renderChatListTicks(last, uid) {
  if (!last) return "";
  const isOut = String(last.sender_id) === String(uid);
  if (!isOut) return "";
  const state = messageDeliveryState(last, true);
  return renderOutgoingTicksHtml(state);
}

function renderChatListItem(entry) {
  const uid = getCurrentUserId();
  const last = entry.last;
  const preview = last
    ? previewMessageBody(last.body, last.recipient_email)
    : "Нет сообщений";
  const time = last ? formatChatListTime(last.created_at) : "";
  const ticks = renderChatListTicks(last, uid);
  const countLabel = entry.count > 0 ? String(entry.count) : "";
  const hue = avatarHue(entry.peerId === CHAT_PEER_ALL ? "general" : entry.email || entry.peerId);
  const initial = entry.kind === "general" ? "#" : avatarInitial(entry.name);
  const unread =
    last &&
    String(last.recipient_id) === String(uid) &&
    !last.read_at;

  return `
    <button
      type="button"
      class="messages-chat-item${unread ? " messages-chat-item--unread" : ""}${entry.kind === "general" ? " messages-chat-item--general" : ""}"
      role="listitem"
      data-peer-id="${escapeHtml(entry.peerId)}"
    >
      <span class="messages-chat-avatar" style="--messages-avatar-hue: ${hue}" aria-hidden="true">${escapeHtml(initial)}</span>
      <span class="messages-chat-item-main">
        <span class="messages-chat-item-top">
          <span class="messages-chat-item-name">${escapeHtml(entry.name)}</span>
          <span class="messages-chat-item-time-wrap">
            ${ticks}
            <time class="messages-chat-item-time">${escapeHtml(time)}</time>
          </span>
        </span>
        <span class="messages-chat-item-bottom">
          <span class="messages-chat-item-preview">${escapeHtml(preview || " ")}</span>
          ${countLabel ? `<span class="messages-chat-item-count" title="Сообщений в переписке">${escapeHtml(countLabel)}</span>` : ""}
        </span>
      </span>
    </button>
  `;
}

export async function loadChatList() {
  const list = document.getElementById("messagesChatList");
  const msg = document.getElementById("messagesChatListMessage");
  if (!list) return;

  const uid = getCurrentUserId();
  if (!uid) return;

  if (msg) {
    msg.textContent = "";
    msg.classList.remove("messages-page-message--error");
  }

  const [users, { rows, error }] = await Promise.all([loadUsersDirectory(), fetchAllUserMessages()]);

  if (error) {
    console.error("Ошибка загрузки сообщений:", error);
    if (msg) {
      msg.textContent = "Ошибка загрузки сообщений. Проверьте, что таблица user_messages создана в Supabase.";
      msg.classList.add("messages-page-message--error");
    }
    list.innerHTML = "";
    return;
  }

  const entries = buildChatListEntries(users, rows);
  list.innerHTML = entries.map(renderChatListItem).join("");
  void refreshMessagesUnreadBadge();
}

function setMessagesView(view) {
  messagesView = view;
  const listView = document.getElementById("messagesChatListView");
  const dialogView = document.getElementById("messagesDialogView");
  if (listView) listView.hidden = view !== "list";
  if (dialogView) dialogView.hidden = view !== "dialog";
  document.getElementById("section-messages")?.classList.toggle("messages-section--dialog", view === "dialog");
}

function syncComposerForActivePeer() {
  const userPickBtn = document.getElementById("messagesPickUserBtn");
  const input = document.getElementById("messagesComposerInput");
  composerRecipients.clear();

  if (isPeerChat()) {
    const users = usersCache || [];
    const peer = users.find((u) => String(u.id) === String(activePeerId));
    if (peer) {
      composerRecipients.set(peer.id, { id: peer.id, email: peer.email });
    }
    if (userPickBtn) userPickBtn.hidden = true;
    if (input) input.placeholder = "Сообщение…";
  } else {
    if (userPickBtn) userPickBtn.hidden = false;
    if (input) input.placeholder = "Новое сообщение…";
  }
  hideSuggestions();
}

function updateDialogHeader() {
  const title = document.getElementById("messagesDialogTitle");
  const subtitle = document.getElementById("messagesDialogSubtitle");
  if (!title) return;

  if (isGeneralChat()) {
    title.textContent = "Общий чат";
    if (subtitle) {
      subtitle.textContent = "Все переписки";
      subtitle.hidden = false;
    }
    return;
  }

  const users = usersCache || [];
  const peer = users.find((u) => String(u.id) === String(activePeerId));
  const name = peer ? displayNameByEmail(peer.email) || peer.email : "Чат";
  title.textContent = name;
  if (subtitle) {
    subtitle.textContent = peer?.email || "";
    subtitle.hidden = !peer?.email;
  }
}

export function showMessagesChatList() {
  activePeerId = null;
  lastFeedMessageAt = null;
  setMessagesView("list");
  stopMessagesFeedPolling();
  startChatListPolling();
  void loadChatList();
}

export async function openMessagesDialog(peerId) {
  activePeerId = peerId || CHAT_PEER_ALL;
  lastFeedMessageAt = null;
  setMessagesView("dialog");
  stopChatListPolling();
  await loadUsersDirectory();
  updateDialogHeader();
  syncComposerForActivePeer();
  await loadMessages();
  startMessagesFeedPolling();
}

export async function loadMessages() {
  const feed = document.getElementById("messagesFeed");
  const msg = document.getElementById("messagesPageMessage");
  if (!feed) return;

  const uid = getCurrentUserId();
  if (!uid) return;

  if (messagesView !== "dialog" || !activePeerId) return;

  if (msg) {
    msg.textContent = "";
    msg.classList.remove("messages-page-message--error");
  }

  const { rows: allRows, error } = await fetchAllUserMessages();

  if (error) {
    console.error("Ошибка загрузки сообщений:", error);
    if (msg) {
      msg.textContent = "Ошибка загрузки сообщений. Проверьте, что таблица user_messages создана в Supabase.";
      msg.classList.add("messages-page-message--error");
    }
    feed.innerHTML = "";
    return;
  }

  const rows = allRows.filter((row) => messageBelongsToPeer(row, activePeerId, uid));
  lastFeedMessageAt = rows.length ? rows[rows.length - 1].created_at : null;
  updateLastMessagePeerId(rows);

  const emptyText = isGeneralChat()
    ? "Пока нет сообщений. Напишите первое: выберите получателя кнопкой с человечком."
    : "Пока нет сообщений в этой переписке. Напишите первое.";

  feed.innerHTML = rows.length
    ? rows.map(renderMessageItem).join("")
    : `<p class="messages-empty">${emptyText}</p>`;

  feed.scrollTop = feed.scrollHeight;

  await markIncomingMessagesRead(rows);
  void refreshMessagesUnreadBadge();
}

export function onMessagesSectionEnter() {
  showMessagesChatList();
}

function getFeedMessageIds() {
  const feed = document.getElementById("messagesFeed");
  if (!feed) return new Set();
  return new Set(
    [...feed.querySelectorAll("[data-message-id]")]
      .map((el) => el.getAttribute("data-message-id"))
      .filter(Boolean),
  );
}

function isFeedAtBottom(feed, threshold = 48) {
  return feed.scrollHeight - feed.scrollTop - feed.clientHeight <= threshold;
}

function appendMessagesToFeed(rows) {
  const feed = document.getElementById("messagesFeed");
  if (!feed || !rows.length) return;

  const uid = getCurrentUserId();
  const scoped = rows.filter((row) => messageBelongsToPeer(row, activePeerId, uid));
  if (!scoped.length) return;

  const existingIds = getFeedMessageIds();
  const newRows = scoped.filter((row) => !existingIds.has(String(row.id)));
  if (!newRows.length) return;

  const atBottom = isFeedAtBottom(feed);
  feed.querySelector(".messages-empty")?.remove();

  const wrapper = document.createElement("div");
  wrapper.innerHTML = newRows.map(renderMessageItem).join("");
  while (wrapper.firstChild) {
    feed.appendChild(wrapper.firstChild);
  }

  for (const row of newRows) {
    if (!lastFeedMessageAt || row.created_at > lastFeedMessageAt) {
      lastFeedMessageAt = row.created_at;
    }
  }
  if (newRows.length) {
    updateLastMessagePeerId(newRows);
  }

  if (atBottom) {
    feed.scrollTop = feed.scrollHeight;
  }
}

async function syncOutgoingReadStatus() {
  const feed = document.getElementById("messagesFeed");
  const uid = getCurrentUserId();
  if (!feed || !uid) return;

  const pendingOutEls = [
    ...feed.querySelectorAll('.message-item--out[data-message-id]:not([data-delivery-status="read"])'),
  ];
  if (!pendingOutEls.length) return;

  const ids = [...new Set(pendingOutEls.map((el) => el.getAttribute("data-message-id")).filter(Boolean))];
  if (!ids.length) return;

  const { data, error } = await supabaseClient
    .from("user_messages")
    .select(deliveredAtSupported === false ? "id, read_at" : "id, read_at, delivered_at")
    .eq("sender_id", uid)
    .in("id", ids);

  if (error) {
    if (noteDeliveredAtSupport(error) && deliveredAtSupported === false) {
      const retry = await supabaseClient
        .from("user_messages")
        .select("id, read_at")
        .eq("sender_id", uid)
        .in("id", ids);
      if (retry.error) {
        console.warn("Ошибка синхронизации статуса исходящих:", retry.error);
        return;
      }
      const byId = new Map((retry.data || []).map((row) => [String(row.id), row]));
      for (const el of pendingOutEls) {
        const id = el.getAttribute("data-message-id");
        const row = id ? byId.get(String(id)) : null;
        if (!row) continue;
        const read = Boolean(row.read_at);
        applyOutgoingStatusToElement(el, { delivered: read, read });
      }
      return;
    }
    console.warn("Ошибка синхронизации статуса исходящих:", error);
    return;
  }

  if (!error) deliveredAtSupported = deliveredAtSupported !== false;

  const byId = new Map((data || []).map((row) => [String(row.id), row]));
  for (const el of pendingOutEls) {
    const id = el.getAttribute("data-message-id");
    const row = id ? byId.get(String(id)) : null;
    if (!row) continue;
    const read = Boolean(row.read_at);
    const delivered = Boolean(row.delivered_at) || read;
    applyOutgoingStatusToElement(el, { delivered, read });
  }
}

async function pollNewMessages() {
  const feed = document.getElementById("messagesFeed");
  const uid = getCurrentUserId();
  if (!feed || !uid || messagesView !== "dialog" || !activePeerId) return;

  let query = supabaseClient
    .from("user_messages")
    .select(messageSelectColumns())
    .or(`sender_id.eq.${uid},recipient_id.eq.${uid}`)
    .order("created_at", { ascending: true });

  if (lastFeedMessageAt) {
    query = query.gte("created_at", lastFeedMessageAt);
  }

  let { data, error } = await query;
  if (error && noteDeliveredAtSupport(error) && deliveredAtSupported === false) {
    let retry = supabaseClient
      .from("user_messages")
      .select(MESSAGE_SELECT_BASIC)
      .or(`sender_id.eq.${uid},recipient_id.eq.${uid}`)
      .order("created_at", { ascending: true });
    if (lastFeedMessageAt) retry = retry.gte("created_at", lastFeedMessageAt);
    ({ data, error } = await retry);
  } else if (!error) {
    deliveredAtSupported = deliveredAtSupported !== false;
  }

  if (error) {
    console.warn("Ошибка проверки новых сообщений:", error);
    await syncOutgoingReadStatus();
    return;
  }

  const rows = (data || []).filter((row) => messageBelongsToPeer(row, activePeerId, uid));
  if (rows.length) {
    appendMessagesToFeed(rows);
    await markIncomingMessagesRead(rows);
    void refreshMessagesUnreadBadge();
  }

  await syncOutgoingReadStatus();
}

export function startMessagesFeedPolling() {
  stopMessagesFeedPolling();
  if (messagesView !== "dialog") return;
  feedPollTimer = window.setInterval(() => {
    void pollNewMessages();
  }, FEED_POLL_MS);
}

export function stopMessagesFeedPolling() {
  if (feedPollTimer) {
    window.clearInterval(feedPollTimer);
    feedPollTimer = null;
  }
}

function startChatListPolling() {
  stopChatListPolling();
  if (messagesView !== "list") return;
  chatListPollTimer = window.setInterval(() => {
    if (messagesView === "list") void loadChatList();
  }, CHAT_LIST_POLL_MS);
}

function stopChatListPolling() {
  if (chatListPollTimer) {
    window.clearInterval(chatListPollTimer);
    chatListPollTimer = null;
  }
}

export function stopMessagesPolling() {
  stopMessagesFeedPolling();
  stopChatListPolling();
}

async function markIncomingMessagesDelivered(ids) {
  const uid = getCurrentUserId();
  if (!uid || !ids?.length || deliveredAtSupported === false) return;

  const now = new Date().toISOString();
  const { error } = await supabaseClient
    .from("user_messages")
    .update({ delivered_at: now })
    .in("id", ids)
    .eq("recipient_id", uid)
    .is("delivered_at", null);

  if (error) {
    if (noteDeliveredAtSupport(error)) return;
    console.warn("Ошибка отметки доставленных:", error);
  } else {
    deliveredAtSupported = true;
  }
}

async function markIncomingMessagesRead(rows) {
  const uid = getCurrentUserId();
  if (!uid) return;

  const incoming = (rows || []).filter((r) => String(r.recipient_id) === String(uid));
  const undeliveredIds = incoming.filter((r) => !r.delivered_at && !r.read_at).map((r) => r.id);
  const unreadIds = incoming.filter((r) => !r.read_at).map((r) => r.id);

  if (undeliveredIds.length) {
    await markIncomingMessagesDelivered(undeliveredIds);
  }

  if (unreadIds.length === 0) return;

  const now = new Date().toISOString();
  const payload =
    deliveredAtSupported === false ? { read_at: now } : { read_at: now, delivered_at: now };
  const { error } = await supabaseClient
    .from("user_messages")
    .update(payload)
    .in("id", unreadIds)
    .eq("recipient_id", uid);

  if (error) {
    if (noteDeliveredAtSupport(error) && deliveredAtSupported === false) {
      const retry = await supabaseClient
        .from("user_messages")
        .update({ read_at: now })
        .in("id", unreadIds)
        .eq("recipient_id", uid);
      if (retry.error) console.error("Ошибка отметки прочитанных:", retry.error);
      return;
    }
    console.error("Ошибка отметки прочитанных:", error);
  }
}

/** Mark undelivered incoming as delivered without reading (badge / background poll). */
async function acknowledgeIncomingDelivered() {
  const uid = getCurrentUserId();
  if (!uid || deliveredAtSupported === false) return;

  const { data, error } = await supabaseClient
    .from("user_messages")
    .select("id")
    .eq("recipient_id", uid)
    .is("delivered_at", null)
    .is("read_at", null);

  if (error) {
    if (noteDeliveredAtSupport(error)) return;
    console.warn("Не удалось проверить недоставленные входящие:", error);
    return;
  }

  deliveredAtSupported = true;
  const ids = (data || []).map((row) => row.id);
  if (ids.length) {
    await markIncomingMessagesDelivered(ids);
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

  // While the app is open, acknowledge delivery without marking as read.
  await acknowledgeIncomingDelivered();

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
  const ampMatch = before.match(/&(\d*)$/);
  if (ampMatch) {
    return { type: "order", query: ampMatch[1], start: caretPos - ampMatch[0].length };
  }
  return null;
}

function filterUsers(query, { limit = 15 } = {}) {
  const q = (query || "").trim().toLowerCase();
  const uid = getCurrentUserId();
  const list = (usersCache || []).filter((u) => u.id !== uid);
  if (!q) return limit > 0 ? list.slice(0, limit) : list;
  return list
    .filter((u) => {
      const email = u.email.toLowerCase();
      const name = displayNameByEmail(u.email).toLowerCase();
      return email.includes(q) || name.includes(q);
    })
    .slice(0, limit > 0 ? limit : list.length);
}

function normalizeOrderStatus(val) {
  if (val === "нет" || val === "оплачен" || val == null || val === "") return "Контакт с клиентом";
  return val;
}

function isOpenOrder(order) {
  return normalizeOrderStatus(order.payment_status) !== "Заказ закрыт";
}

function filterOrders(query, { onlyOpen = false, limit = 15 } = {}) {
  const q = (query || "").trim().toLowerCase();
  let orders = state.allOrders || [];
  if (onlyOpen) {
    orders = orders.filter((order) => isOpenOrder(order) && !isOrderHiddenForCurrentRole(order));
  }
  const out = [];
  for (const o of orders) {
    if (!q) {
      out.push(o);
    } else {
      const idStr = String(o.id ?? "");
      const chip = formatOrderIdTypeChip(o.id, o.order_type).toLowerCase();
      const client = (o.client || "").trim().toLowerCase();
      const address = (o.address || "").trim().toLowerCase();
      const description = (o.description || "").trim().toLowerCase();
      if (
        idStr.includes(q) ||
        chip.includes(q) ||
        client.includes(q) ||
        address.includes(q) ||
        description.includes(q)
      ) {
        out.push(o);
      }
    }
    if (limit > 0 && out.length >= limit) break;
  }
  return out;
}

function mapOrderPickerItems(orders) {
  return orders.map((order) => ({
    order,
    orderRowHtml: buildOrderPickerRowHtml(order),
  }));
}

function hideSuggestions() {
  const list = document.getElementById("messagesComposerSuggestions");
  if (list) {
    list.hidden = true;
    list.innerHTML = "";
    list.classList.remove("messages-suggestions--orders", "messages-suggestions--recipients");
  }
  activePicker = null;
  syncPickerButtonStates();
}

function syncPickerButtonStates() {
  const userBtn = document.getElementById("messagesPickUserBtn");
  const orderBtn = document.getElementById("messagesPickOrderBtn");
  if (userBtn) {
    const on = activePicker === "user";
    userBtn.classList.toggle("messages-composer-tool-btn--active", on);
    userBtn.setAttribute("aria-expanded", on ? "true" : "false");
  }
  if (orderBtn) {
    const on = activePicker === "order";
    orderBtn.classList.toggle("messages-composer-tool-btn--active", on);
    orderBtn.setAttribute("aria-expanded", on ? "true" : "false");
  }
}

function syncComposerRecipientsFromList(list) {
  composerRecipients.clear();
  list.querySelectorAll(".messages-recipient-option[aria-checked='true']").forEach((btn) => {
    const mark = btn.querySelector(".messages-recipient-checkbox");
    if (!mark?.dataset.value) return;
    composerRecipients.set(mark.dataset.value, { id: mark.dataset.value, email: mark.dataset.email });
  });
}

function getDefaultRecipientIds(users) {
  if (composerRecipients.size > 0) {
    return new Set([...composerRecipients.keys()]);
  }
  if (lastMessagePeerId && users.some((u) => String(u.id) === String(lastMessagePeerId))) {
    return new Set([String(lastMessagePeerId)]);
  }
  return new Set();
}

function ensureComposerRecipientsDefault(users) {
  if (composerRecipients.size > 0) return;
  const selectedIds = getDefaultRecipientIds(users);
  for (const user of users) {
    if (selectedIds.has(String(user.id))) {
      composerRecipients.set(user.id, { id: user.id, email: user.email });
    }
  }
}

function showUserRecipientPicker(users) {
  const list = document.getElementById("messagesComposerSuggestions");
  if (!list) return;
  if (!users.length) {
    hideSuggestions();
    return;
  }

  const selectedIds = getDefaultRecipientIds(users);
  composerRecipients.clear();
  for (const user of users) {
    if (selectedIds.has(String(user.id))) {
      composerRecipients.set(user.id, { id: user.id, email: user.email });
    }
  }

  list.classList.remove("messages-suggestions--orders");
  list.classList.add("messages-suggestions--recipients");
  list.innerHTML = users
    .map((user) => {
      const checked = selectedIds.has(String(user.id));
      return `
    <li>
      <button
        type="button"
        class="messages-recipient-option"
        role="checkbox"
        aria-checked="${checked ? "true" : "false"}"
      >
        <span
          class="messages-recipient-checkbox"
          data-value="${escapeHtml(user.id)}"
          data-email="${escapeHtml(user.email)}"
          aria-hidden="true"
        ></span>
        <span class="messages-suggestion-text">${escapeHtml(displayNameByEmail(user.email))}</span>
      </button>
    </li>
  `;
    })
    .join("");
  list.hidden = false;

  list.querySelectorAll(".messages-recipient-option").forEach((btn) => {
    const mark = btn.querySelector(".messages-recipient-checkbox");
    if (mark && btn.getAttribute("aria-checked") === "true") {
      mark.classList.add("messages-recipient-checkbox--checked");
    }
    btn.addEventListener("click", () => {
      const on = btn.getAttribute("aria-checked") !== "true";
      btn.setAttribute("aria-checked", on ? "true" : "false");
      if (mark) mark.classList.toggle("messages-recipient-checkbox--checked", on);
      syncComposerRecipientsFromList(list);
    });
  });

  list.onmousedown = (e) => {
    e.preventDefault();
  };
}

function showOrderSuggestions(items, onPick) {
  const list = document.getElementById("messagesComposerSuggestions");
  if (!list) return;
  if (!items.length) {
    hideSuggestions();
    return;
  }

  list.classList.remove("messages-suggestions--recipients");
  list.classList.add("messages-suggestions--orders");
  list.innerHTML = items
    .map(
      (item, idx) => `
    <li role="option" data-index="${idx}" aria-selected="${idx === 0 ? "true" : "false"}">
      ${item.orderRowHtml}
    </li>
  `,
    )
    .join("");
  list.hidden = false;

  list.querySelectorAll(".td-order-client, .td-order-address, .td-order-description").forEach((cell) => {
    const full = cell.getAttribute("data-fulltext");
    if (full) cell.setAttribute("title", full);
    else cell.removeAttribute("title");
  });

  list.querySelectorAll("li").forEach((li) => {
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const idx = Number(li.dataset.index);
      const picked = items[idx];
      if (picked) onPick(picked);
    });
  });
}

function applyOrderPick(input, order, ctx = null) {
  const caret = getTextareaCaret(input);
  const start = ctx ? ctx.start : caret.start;
  const end = ctx ? caret.end : caret.end;
  const text = input.value;
  const before = text.slice(0, start);
  const after = text.slice(end);
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
    if (activePicker === "user") return;
    hideSuggestions();
    return;
  }

  activePicker = ctx.type;
  syncPickerButtonStates();

  if (ctx.type === "order") {
    const orders = filterOrders(ctx.query);
    showOrderSuggestions(mapOrderPickerItems(orders), (item) => applyOrderPick(input, item.order, ctx));
  }
}

function openUserPicker(input) {
  if (activePicker === "user") {
    hideSuggestions();
    return;
  }
  activePicker = "user";
  syncPickerButtonStates();
  const users = filterUsers("", { limit: 0 });
  showUserRecipientPicker(users);
  input.focus();
}

function openOrderPicker(input) {
  if (activePicker === "order") {
    hideSuggestions();
    return;
  }
  activePicker = "order";
  syncPickerButtonStates();
  const orders = filterOrders("", { onlyOpen: true, limit: 0 });
  showOrderSuggestions(mapOrderPickerItems(orders), (item) => applyOrderPick(input, item.order));
  input.focus();
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

  const users = await loadUsersDirectory();

  if (isPeerChat()) {
    const peer = users.find((u) => String(u.id) === String(activePeerId));
    if (!peer) {
      if (msg) {
        msg.textContent = "Не удалось определить получателя.";
        msg.classList.add("messages-page-message--error");
      }
      return;
    }
    composerRecipients.clear();
    composerRecipients.set(peer.id, { id: peer.id, email: peer.email });
  } else {
    ensureComposerRecipientsDefault(users);
  }

  const recipientList = [...composerRecipients.values()].filter((recipient) => recipient.id !== uid);
  if (!recipientList.length) {
    if (msg) {
      msg.textContent = isPeerChat()
        ? "Не удалось определить получателя."
        : "Выберите получателя кнопкой с человечком.";
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
  const inserts = recipientList.map((recipient) => ({
    sender_id: uid,
    recipient_id: recipient.id,
    sender_email: senderEmail,
    recipient_email: recipient.email,
    body,
  }));

  const { error } = await supabaseClient.from("user_messages").insert(inserts);

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
  if (!isPeerChat()) {
    composerRecipients.clear();
  }
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

function onChatListClick(e) {
  const item = e.target.closest(".messages-chat-item[data-peer-id]");
  if (!item) return;
  const peerId = item.getAttribute("data-peer-id");
  if (!peerId) return;
  void openMessagesDialog(peerId);
}

export function initMessagesSection() {
  const navBtn = document.getElementById("messagesNavBtn");
  const sendBtn = document.getElementById("messagesSendBtn");
  const input = document.getElementById("messagesComposerInput");
  const feed = document.getElementById("messagesFeed");
  const chatList = document.getElementById("messagesChatList");
  const backBtn = document.getElementById("messagesBackBtn");

  if (navBtn) {
    navBtn.addEventListener("click", () => {
      import("./section-nav.js").then((m) => m.switchSection("messages"));
    });
  }

  if (backBtn) {
    backBtn.addEventListener("click", () => {
      showMessagesChatList();
    });
  }

  if (chatList) {
    chatList.addEventListener("click", onChatListClick);
  }

  if (sendBtn) {
    sendBtn.addEventListener("click", () => void sendMessage());
  }

  const msgEl = document.getElementById("messagesPageMessage");
  if (feed) {
    feed.addEventListener("click", onFeedClick);
  }

  const userPickBtn = document.getElementById("messagesPickUserBtn");
  const orderPickBtn = document.getElementById("messagesPickOrderBtn");

  if (userPickBtn && input) {
    userPickBtn.addEventListener("mousedown", (e) => e.preventDefault());
    userPickBtn.addEventListener("click", () => {
      if (isPeerChat()) return;
      void loadUsersDirectory().then(() => openUserPicker(input));
    });
  }

  if (orderPickBtn && input) {
    orderPickBtn.addEventListener("mousedown", (e) => e.preventDefault());
    orderPickBtn.addEventListener("click", () => openOrderPicker(input));
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

      if (list.classList.contains("messages-suggestions--recipients")) {
        if (e.key === "Escape") hideSuggestions();
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

export { ORDER_TOKEN_RE, CHAT_PEER_ALL };
