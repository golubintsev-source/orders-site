import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import { formatOrderIdTypeChip, formatTaskDateRu } from "./format.js";
import { avatarLogoUrl, displayNameByEmail } from "./user-names.js";
import { buildOrderPickerRowHtml, viewOrder } from "./orders.js";
import { isOrderHiddenForCurrentRole } from "./roles.js";
import {
  attachStorageFileToOrder,
  cropImageAttachment,
  getSignedFileUrl,
  uploadChatPhoto,
} from "./files.js";

const ORDER_TOKEN_RE = /\[\[order:(\d+)\]\]/g;
/** Максимальная высота поля ввода сообщения (как в CSS max-height). */
const COMPOSER_INPUT_MAX_HEIGHT_PX = 120;
const SUGGEST_DEBOUNCE_MS = 120;
const UNREAD_POLL_MS = 60_000;
const FEED_POLL_MS = 15_000;
const CHAT_LIST_POLL_MS = 20_000;
/** Префикс peer id для группового чата. */
const GROUP_PEER_PREFIX = "group:";
const ATTACHMENT_SELECT_COLS =
  "attachment_storage_path, attachment_thumbnail_path, attachment_mime_type, attachment_file_name, attachment_file_size";

let usersCache = null;
let usersCachePromise = null;
let unreadPollTimer = null;
let feedPollTimer = null;
let chatListPollTimer = null;
let lastFeedMessageAt = null;
let lastMessagePeerId = null;
/** @type {"list" | "dialog"} */
let messagesView = "list";
/** @type {string | null} null на списке; uuid пользователя или group:<uuid> в диалоге */
let activePeerId = null;
/** @type {Map<string, { id: string, name: string, memberIds: string[], created_at?: string }>} */
let groupChatsById = new Map();
/** @type {Map<string, { id: string, email: string }>} */
let composerRecipients = new Map();
let activePicker = null;
/** null = unknown, true/false after first probe */
let deliveredAtSupported = null;
/** null = unknown, true/false after first probe */
let groupChatsSupported = null;
/** null = unknown, true/false after first probe */
let attachmentColumnsSupported = null;
/** null = unknown, true/false after first probe — reply_to_id / edited_at / deleted_at */
let messageActionsSupported = null;
/** @type {{ file: File, previewUrl: string } | null} */
let pendingChatPhoto = null;
/** Фото из чата, которое пользователь хочет прикрепить к заказу через список заказов. */
/** @type {{ storagePath: string, thumbnailPath: string, fileName: string, mimeType: string, fileSize: number|null } | null} */
let pendingAttachPhotoToOrder = null;
/** @type {Map<string, object>} кэш сообщений текущего диалога (включая удалённые для цитат) */
let feedMessagesById = new Map();
/** @type {object | null} сообщение, на которое отвечаем */
let composerReplyTo = null;
/** @type {object | null} сообщение, которое редактируем */
let composerEditing = null;
/** @type {string | null} id сообщения под меню действий */
let actionMenuMessageId = null;
/** true, если меню открыли долгим нажатием / ПКМ по фото */
let actionMenuFromPhoto = false;
let longPressTimer = null;
let longPressMessageEl = null;
let longPressStartX = 0;
let longPressStartY = 0;
let longPressTriggered = false;
let longPressFromPhoto = false;
const LONG_PRESS_MS = 480;
const LONG_PRESS_MOVE_PX = 12;

const MESSAGE_ACTION_COLS = "reply_to_id, edited_at, deleted_at";
const MESSAGE_SELECT_WITH_DELIVERED =
  "id, sender_id, recipient_id, sender_email, recipient_email, body, created_at, read_at, delivered_at";
const MESSAGE_SELECT_BASIC =
  "id, sender_id, recipient_id, sender_email, recipient_email, body, created_at, read_at";

function withAttachmentColumns(base) {
  if (attachmentColumnsSupported === false) return base;
  return `${base}, ${ATTACHMENT_SELECT_COLS}`;
}

function withMessageActionColumns(base) {
  if (messageActionsSupported === false) return base;
  return `${base}, ${MESSAGE_ACTION_COLS}`;
}

function messageSelectColumns() {
  const base = deliveredAtSupported === false ? MESSAGE_SELECT_BASIC : MESSAGE_SELECT_WITH_DELIVERED;
  return withMessageActionColumns(withAttachmentColumns(base));
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

function noteAttachmentSupport(error) {
  if (!error) {
    attachmentColumnsSupported = true;
    return false;
  }
  const msg = `${error.message || ""} ${error.details || ""} ${error.hint || ""}`.toLowerCase();
  if (
    msg.includes("attachment_storage_path") ||
    msg.includes("attachment_thumbnail_path") ||
    msg.includes("attachment_mime_type") ||
    msg.includes("attachment_file_name") ||
    msg.includes("attachment_file_size")
  ) {
    attachmentColumnsSupported = false;
    return true;
  }
  return false;
}

function noteMessageActionsSupport(error) {
  if (!error) {
    messageActionsSupported = true;
    return false;
  }
  const msg = `${error.message || ""} ${error.details || ""} ${error.hint || ""} ${error.code || ""}`.toLowerCase();
  if (
    msg.includes("reply_to_id") ||
    msg.includes("edited_at") ||
    msg.includes("deleted_at") ||
    error.code === "PGRST204" ||
    error.code === "42703"
  ) {
    // PGRST204 / 42703 могут относиться и к другим колонкам — проверяем текст.
    if (
      msg.includes("reply_to_id") ||
      msg.includes("edited_at") ||
      msg.includes("deleted_at")
    ) {
      messageActionsSupported = false;
      return true;
    }
  }
  return false;
}

function isMessageDeleted(row) {
  return Boolean(row?.deleted_at);
}

function rememberFeedMessages(rows) {
  for (const row of rows || []) {
    if (row?.id == null) continue;
    feedMessagesById.set(String(row.id), row);
  }
}

function clearFeedMessageCache() {
  feedMessagesById = new Map();
}

function getMessageActionsSetupHint() {
  return "Действия с сообщениями не настроены. Выполните supabase_message_actions.sql в Supabase.";
}

function messageHasAttachment(row) {
  return Boolean(row?.attachment_storage_path);
}

function attachmentFieldsFromUpload(uploaded) {
  if (!uploaded) return {};
  return {
    attachment_storage_path: uploaded.storagePath,
    attachment_thumbnail_path: uploaded.thumbnailPath,
    attachment_mime_type: uploaded.mimeType,
    attachment_file_name: uploaded.fileName,
    attachment_file_size: uploaded.fileSize,
  };
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

function toGroupPeerId(groupId) {
  return `${GROUP_PEER_PREFIX}${groupId}`;
}

function isGroupChat(peerId = activePeerId) {
  return Boolean(peerId) && String(peerId).startsWith(GROUP_PEER_PREFIX);
}

function parseGroupId(peerId = activePeerId) {
  if (!isGroupChat(peerId)) return null;
  return String(peerId).slice(GROUP_PEER_PREFIX.length);
}

function isPeerChat(peerId = activePeerId) {
  return Boolean(peerId) && !isGroupChat(peerId);
}

function messageBelongsToPeer(row, peerId, uid) {
  if (!peerId || isGroupChat(peerId)) return false;
  const me = String(uid);
  const peer = String(peerId);
  const sid = String(row.sender_id);
  const rid = String(row.recipient_id);
  return (sid === me && rid === peer) || (sid === peer && rid === me);
}

function peerIdFromMessage(row, uid) {
  return String(row.sender_id) === String(uid) ? String(row.recipient_id) : String(row.sender_id);
}

function noteGroupChatsSupport(error) {
  if (!error) {
    groupChatsSupported = true;
    return false;
  }
  const msg = `${error.message || ""} ${error.details || ""} ${error.hint || ""} ${error.code || ""}`.toLowerCase();
  if (
    msg.includes("group_chats") ||
    msg.includes("group_messages") ||
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.code === "PGRST204"
  ) {
    groupChatsSupported = false;
    return true;
  }
  return false;
}

/** Родительный падеж месяца для даты в списке чатов («25 июля»). */
const CHAT_LIST_MONTHS_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

/** Время в списке чатов: HH:MM сегодня, иначе «25 июля». */
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
  return `${d.getDate()} ${CHAT_LIST_MONTHS_GENITIVE[d.getMonth()]}`;
}

function previewMessageBody(body, recipientEmail, row = null) {
  if (isMessageDeleted(row)) return "Сообщение удалено";
  if (messageHasAttachment(row) && !String(body || "").trim()) {
    return "Фото";
  }
  const stripped = stripRecipientMentionFromBody(body, recipientEmail);
  const text = String(stripped || "")
    .replace(/\[\[order:(\d+)\]\]/g, (_, id) => `#${id}`)
    .replace(/\s+/g, " ")
    .trim();
  if (messageHasAttachment(row) && text) return `Фото · ${text}`;
  if (messageHasAttachment(row)) return "Фото";
  return text;
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

function renderMessageAttachmentHtml(row) {
  if (!messageHasAttachment(row)) return "";
  const fileName = row.attachment_file_name || "Фото";
  const alt = escapeHtml(fileName);
  const mime = escapeHtml(row.attachment_mime_type || "");
  const size =
    row.attachment_file_size != null && Number.isFinite(Number(row.attachment_file_size))
      ? String(row.attachment_file_size)
      : "";
  return `<div class="message-item-attachment" data-storage-path="${escapeHtml(row.attachment_storage_path || "")}" data-thumb-path="${escapeHtml(row.attachment_thumbnail_path || "")}" data-mime-type="${mime}" data-file-name="${escapeHtml(fileName)}" data-file-size="${escapeHtml(size)}">
      <div class="message-item-photo-loading" aria-hidden="true">Загрузка…</div>
      <a class="message-item-photo-link" href="#" target="_blank" rel="noopener noreferrer" title="Открыть полное изображение" hidden>
        <img class="message-item-photo" alt="${alt}" decoding="async" />
      </a>
    </div>`;
}

function renderReplyQuoteHtml(row) {
  if (!row?.reply_to_id || messageActionsSupported === false) return "";
  const replyId = String(row.reply_to_id);
  const target = feedMessagesById.get(replyId);
  const uid = getCurrentUserId();
  let authorLabel = "Сообщение";
  let preview = "Сообщение удалено";
  if (target && !isMessageDeleted(target)) {
    const isOwn = String(target.sender_id) === String(uid);
    const name =
      displayNameByEmail(target.sender_email) || target.sender_email || "Участник";
    authorLabel = isOwn ? "Вы" : name;
    preview =
      previewMessageBody(target.body, target.recipient_email, target) || "Сообщение";
  } else if (!target) {
    preview = "Сообщение недоступно";
  }
  return `<button type="button" class="message-item-reply" data-reply-to-id="${escapeHtml(replyId)}" aria-label="Перейти к сообщению">
      <span class="message-item-reply-author">${escapeHtml(authorLabel)}</span>
      <span class="message-item-reply-text">${escapeHtml(preview)}</span>
    </button>`;
}

function renderMessageItem(row) {
  if (isMessageDeleted(row)) return "";
  const uid = getCurrentUserId();
  const isOut = String(row.sender_id) === String(uid);
  const peerEmail = isOut ? row.recipient_email : row.sender_email;
  const peerName = displayNameByEmail(peerEmail || row.sender_email) || peerEmail || row.sender_email || "—";
  const showPeer = isGroupChat();
  const peerLabel = isOut ? "Вы" : peerName;
  const state = messageDeliveryState(row, isOut);
  const bodyForDisplay = stripRecipientMentionFromBody(row.body, row.recipient_email);
  const bodyHtml = renderMessageBodyHtml(bodyForDisplay);
  const attachmentHtml = renderMessageAttachmentHtml(row);
  const replyHtml = renderReplyQuoteHtml(row);
  const showTicks = isOut && !isGroupChat();
  const statusAttr = showTicks ? ` data-delivery-status="${state.status}"` : "";
  const editedLabel = row.edited_at ? `<span class="message-item-edited" title="Изменено">изм.</span>` : "";
  const timeHtml = `<time class="message-item-time">${escapeHtml(formatTaskDateRu(row.created_at))}</time>`;
  const metaTrailing = showTicks
    ? `${editedLabel}${renderOutgoingTicksHtml(state)}${timeHtml}`
    : `${editedLabel}${timeHtml}`;
  const headerHtml = showPeer
    ? `<header class="message-item-header">
        <span class="message-item-peer">${escapeHtml(peerLabel)}</span>
        <span class="message-item-meta">${metaTrailing}</span>
      </header>`
    : `<header class="message-item-header message-item-header--compact">
        <span class="message-item-meta">${metaTrailing}</span>
      </header>`;
  const textBlock = bodyHtml
    ? `<div class="message-item-body message-item-body-text">${bodyHtml}</div>`
    : "";
  const ownAttr = isOut ? ' data-own="1"' : ' data-own="0"';
  return `
    <article class="${messageItemClass(row)}" data-message-id="${row.id}"${statusAttr}${ownAttr}>
      ${headerHtml}
      ${replyHtml}
      ${attachmentHtml}
      ${textBlock}
    </article>
  `;
}

function waitForImageSettle(img, timeoutMs = 4000) {
  if (!img || img.complete) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    img.addEventListener("load", finish, { once: true });
    img.addEventListener("error", finish, { once: true });
  });
}

async function hydrateMessageAttachments(root = document.getElementById("messagesFeed")) {
  if (!root) return;
  const nodes = [...root.querySelectorAll(".message-item-attachment[data-storage-path]")];
  await Promise.all(
    nodes.map(async (el) => {
      if (el.dataset.hydrated === "1") return;
      const storagePath = el.getAttribute("data-storage-path") || "";
      const thumbPath = el.getAttribute("data-thumb-path") || "";
      if (!storagePath) return;
      const [fullUrl, thumbUrl] = await Promise.all([
        getSignedFileUrl(storagePath),
        thumbPath ? getSignedFileUrl(thumbPath) : Promise.resolve(null),
      ]);
      const previewUrl = thumbUrl || fullUrl;
      const loading = el.querySelector(".message-item-photo-loading");
      const link = el.querySelector(".message-item-photo-link");
      const img = el.querySelector(".message-item-photo");
      if (!previewUrl || !link || !img) {
        if (loading) loading.textContent = "Фото недоступно";
        return;
      }
      img.src = previewUrl;
      link.href = fullUrl || previewUrl;
      link.hidden = false;
      if (loading) loading.remove();
      el.dataset.hydrated = "1";
      await waitForImageSettle(img);
    })
  );
}

async function fetchAllUserMessages() {
  const uid = getCurrentUserId();
  if (!uid) return { rows: [], error: null };

  let { data, error } = await supabaseClient
    .from("user_messages")
    .select(messageSelectColumns())
    .or(`sender_id.eq.${uid},recipient_id.eq.${uid}`)
    .order("created_at", { ascending: true });

  if (error && noteMessageActionsSupport(error)) {
    ({ data, error } = await supabaseClient
      .from("user_messages")
      .select(messageSelectColumns())
      .or(`sender_id.eq.${uid},recipient_id.eq.${uid}`)
      .order("created_at", { ascending: true }));
  }

  if (error && noteAttachmentSupport(error)) {
    ({ data, error } = await supabaseClient
      .from("user_messages")
      .select(messageSelectColumns())
      .or(`sender_id.eq.${uid},recipient_id.eq.${uid}`)
      .order("created_at", { ascending: true }));
  }

  if (error && noteDeliveredAtSupport(error) && deliveredAtSupported === false) {
    ({ data, error } = await supabaseClient
      .from("user_messages")
      .select(messageSelectColumns())
      .or(`sender_id.eq.${uid},recipient_id.eq.${uid}`)
      .order("created_at", { ascending: true }));
  } else if (!error) {
    deliveredAtSupported = deliveredAtSupported !== false;
    if (attachmentColumnsSupported !== false) attachmentColumnsSupported = true;
    if (messageActionsSupported !== false) messageActionsSupported = true;
  }

  return { rows: data || [], error };
}

async function fetchMyGroupChats() {
  if (groupChatsSupported === false) return { chats: [], error: null };

  const uid = getCurrentUserId();
  if (!uid) return { chats: [], error: null };

  const { data, error } = await supabaseClient
    .from("group_chats")
    .select("id, name, created_by, member_ids, created_at")
    .contains("member_ids", [uid])
    .order("created_at", { ascending: false });

  if (error) {
    if (noteGroupChatsSupport(error)) return { chats: [], error: null };
    return { chats: [], error };
  }

  groupChatsSupported = true;
  const chats = (data || []).map((row) => ({
    id: String(row.id),
    name: String(row.name || "").trim() || "Групповой чат",
    created_by: row.created_by,
    memberIds: (row.member_ids || []).map(String),
    created_at: row.created_at,
  }));

  groupChatsById = new Map(chats.map((chat) => [chat.id, chat]));
  return { chats, error: null };
}

async function fetchGroupMessages(chatId) {
  if (!chatId || groupChatsSupported === false) return { rows: [], error: null };

  const selectBase = "id, chat_id, sender_id, sender_email, body, created_at";
  let select = withMessageActionColumns(withAttachmentColumns(selectBase));
  let { data, error } = await supabaseClient
    .from("group_messages")
    .select(select)
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });

  if (error && noteMessageActionsSupport(error)) {
    select = withMessageActionColumns(withAttachmentColumns(selectBase));
    ({ data, error } = await supabaseClient
      .from("group_messages")
      .select(select)
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true }));
  }

  if (error && noteAttachmentSupport(error)) {
    select = withMessageActionColumns(withAttachmentColumns(selectBase));
    ({ data, error } = await supabaseClient
      .from("group_messages")
      .select(select)
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true }));
  }

  if (error) {
    if (noteGroupChatsSupport(error)) return { rows: [], error: null };
    return { rows: [], error };
  }

  groupChatsSupported = true;
  if (attachmentColumnsSupported !== false) attachmentColumnsSupported = true;
  if (messageActionsSupported !== false) messageActionsSupported = true;
  return { rows: data || [], error: null };
}

async function fetchLastGroupMessagesByChat(chatIds) {
  if (!chatIds?.length || groupChatsSupported === false) return new Map();

  const selectBase = "id, chat_id, sender_id, sender_email, body, created_at";
  let select = withMessageActionColumns(withAttachmentColumns(selectBase));
  let { data, error } = await supabaseClient
    .from("group_messages")
    .select(select)
    .in("chat_id", chatIds)
    .order("created_at", { ascending: false });

  if (error && noteMessageActionsSupport(error)) {
    select = withMessageActionColumns(withAttachmentColumns(selectBase));
    ({ data, error } = await supabaseClient
      .from("group_messages")
      .select(select)
      .in("chat_id", chatIds)
      .order("created_at", { ascending: false }));
  }

  if (error && noteAttachmentSupport(error)) {
    select = withMessageActionColumns(withAttachmentColumns(selectBase));
    ({ data, error } = await supabaseClient
      .from("group_messages")
      .select(select)
      .in("chat_id", chatIds)
      .order("created_at", { ascending: false }));
  }

  if (error) {
    if (noteGroupChatsSupport(error)) return new Map();
    console.warn("Ошибка загрузки сообщений групповых чатов:", error);
    return new Map();
  }

  const lastByChat = new Map();
  for (const row of data || []) {
    if (isMessageDeleted(row)) continue;
    const chatId = String(row.chat_id);
    if (!lastByChat.has(chatId)) {
      lastByChat.set(chatId, row);
    }
  }
  return lastByChat;
}

function buildChatListEntries(users, rows, groupChats, lastGroupMessages) {
  const uid = getCurrentUserId();
  const byPeer = new Map();

  for (const row of rows) {
    if (isMessageDeleted(row)) continue;
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
    const unreadCount = (bucket?.messages || []).filter(
      (m) => String(m.recipient_id) === String(uid) && !m.read_at
    ).length;
    const name = displayNameByEmail(user.email) || user.email || "—";
    return {
      peerId: String(user.id),
      kind: "user",
      name,
      email: user.email,
      unreadCount,
      last,
      sortAt: last?.created_at || "",
    };
  });

  const groupEntries = (groupChats || []).map((chat) => {
    const last = lastGroupMessages?.get(chat.id) || null;
    return {
      peerId: toGroupPeerId(chat.id),
      kind: "group",
      name: chat.name,
      email: "",
      unreadCount: 0,
      last: last
        ? {
            ...last,
            recipient_id: null,
            recipient_email: "",
            read_at: null,
            delivered_at: null,
          }
        : null,
      sortAt: last?.created_at || chat.created_at || "",
    };
  });

  const entries = [...groupEntries, ...userEntries];
  entries.sort((a, b) => {
    if (a.sortAt && b.sortAt) return a.sortAt < b.sortAt ? 1 : a.sortAt > b.sortAt ? -1 : 0;
    if (a.sortAt) return -1;
    if (b.sortAt) return 1;
    if (a.kind !== b.kind) return a.kind === "group" ? -1 : 1;
    return a.name.localeCompare(b.name, "ru");
  });

  return entries;
}

function renderChatListTicks(last, uid) {
  if (!last) return "";
  const isOut = String(last.sender_id) === String(uid);
  if (!isOut) return "";
  if (last.recipient_id == null && last.chat_id) return "";
  const state = messageDeliveryState(last, true);
  // В списке чатов: прочитано — две синие, доставлено/отправлено — одна.
  if (state.read) {
    return renderOutgoingTicksHtml({ ...state, status: "read" });
  }
  return renderOutgoingTicksHtml({ ...state, status: "sent" });
}

function renderChatListItem(entry) {
  const uid = getCurrentUserId();
  const last = entry.last;
  const preview = last
    ? previewMessageBody(last.body, last.recipient_email, last)
    : "Нет сообщений";
  const time = last ? formatChatListTime(last.created_at) : "";
  const ticks = entry.kind === "group" ? "" : renderChatListTicks(last, uid);
  const unreadCount = entry.unreadCount || 0;
  const countLabel = unreadCount > 0 ? (unreadCount > 99 ? "99+" : String(unreadCount)) : "";
  const hue = avatarHue(entry.kind === "group" ? entry.peerId : entry.email || entry.peerId);
  const initial = avatarInitial(entry.name);
  const logoUrl =
    entry.kind === "group" ? null : avatarLogoUrl({ email: entry.email, name: entry.name });
  const unread = entry.kind !== "group" && unreadCount > 0;
  const avatarHtml = logoUrl
    ? `<span class="messages-chat-avatar messages-chat-avatar--logo" aria-hidden="true"><img src="${escapeHtml(logoUrl)}" alt="" width="48" height="48" decoding="async"></span>`
    : `<span class="messages-chat-avatar" style="--messages-avatar-hue: ${hue}" aria-hidden="true">${escapeHtml(initial)}</span>`;

  return `
    <button
      type="button"
      class="messages-chat-item${unread ? " messages-chat-item--unread" : ""}${entry.kind === "group" ? " messages-chat-item--group" : ""}"
      role="listitem"
      data-peer-id="${escapeHtml(entry.peerId)}"
    >
      ${avatarHtml}
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
          ${countLabel ? `<span class="messages-chat-item-count" title="Непрочитанных сообщений">${escapeHtml(countLabel)}</span>` : ""}
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

  const [users, { rows, error }, { chats: groupChats, error: groupError }] = await Promise.all([
    loadUsersDirectory(),
    fetchAllUserMessages(),
    fetchMyGroupChats(),
  ]);

  if (error) {
    console.error("Ошибка загрузки сообщений:", error);
    if (msg) {
      msg.textContent = "Ошибка загрузки сообщений. Проверьте, что таблица user_messages создана в Supabase.";
      msg.classList.add("messages-page-message--error");
    }
    list.innerHTML = "";
    return;
  }

  if (groupError) {
    console.warn("Ошибка загрузки групповых чатов:", groupError);
  }

  const lastGroupMessages = await fetchLastGroupMessagesByChat(groupChats.map((chat) => chat.id));
  const entries = buildChatListEntries(users, rows, groupChats, lastGroupMessages);
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
  clearPendingChatPhoto();
  closeAttachPhotoMenu();

  if (isPeerChat()) {
    const users = usersCache || [];
    const peer = users.find((u) => String(u.id) === String(activePeerId));
    if (peer) {
      composerRecipients.set(peer.id, { id: peer.id, email: peer.email });
    }
    if (userPickBtn) userPickBtn.hidden = true;
    if (input) input.placeholder = "Сообщение…";
  } else if (isGroupChat()) {
    if (userPickBtn) userPickBtn.hidden = true;
    if (input) input.placeholder = "Сообщение в группу…";
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

  if (isGroupChat()) {
    const groupId = parseGroupId();
    const chat = groupId ? groupChatsById.get(groupId) : null;
    title.textContent = chat?.name || "Групповой чат";
    if (subtitle) {
      const memberCount = chat?.memberIds?.length || 0;
      subtitle.textContent = memberCount ? `${memberCount} участн.` : "";
      subtitle.hidden = !memberCount;
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
  clearComposerContext();
  hideMessageActionMenu();
  clearFeedMessageCache();
  setMessagesView("list");
  stopMessagesFeedPolling();
  startChatListPolling();
  void loadChatList();
}

export async function openMessagesDialog(peerId) {
  if (!peerId) return;
  activePeerId = peerId;
  lastFeedMessageAt = null;
  clearComposerContext();
  hideMessageActionMenu();
  clearFeedMessageCache();
  setMessagesView("dialog");
  stopChatListPolling();
  await loadUsersDirectory();
  if (isGroupChat() && groupChatsById.size === 0) {
    await fetchMyGroupChats();
  }
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

  let rows = [];
  if (isGroupChat()) {
    const groupId = parseGroupId();
    const { rows: groupRows, error } = await fetchGroupMessages(groupId);
    if (error) {
      console.error("Ошибка загрузки сообщений группы:", error);
      if (msg) {
        msg.textContent = "Ошибка загрузки сообщений группового чата.";
        msg.classList.add("messages-page-message--error");
      }
      feed.innerHTML = "";
      return;
    }
    rows = groupRows;
  } else {
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
    rows = allRows.filter((row) => messageBelongsToPeer(row, activePeerId, uid));
  }

  lastFeedMessageAt = rows.length ? rows[rows.length - 1].created_at : null;
  updateLastMessagePeerId(isGroupChat() ? [] : rows.filter((r) => !isMessageDeleted(r)));

  clearFeedMessageCache();
  rememberFeedMessages(rows);

  const visibleRows = rows.filter((row) => !isMessageDeleted(row));
  const emptyText = isGroupChat()
    ? "Пока нет сообщений в этом групповом чате. Напишите первое."
    : "Пока нет сообщений в этой переписке. Напишите первое.";

  feed.innerHTML = visibleRows.length
    ? visibleRows.map(renderMessageItem).join("")
    : `<p class="messages-empty">${emptyText}</p>`;

  scrollMessagesFeedToBottom(feed);
  const keepAtBottom = (event) => {
    if (event.target?.tagName === "IMG") scrollMessagesFeedToBottom(feed);
  };
  feed.addEventListener("load", keepAtBottom, true);
  try {
    await hydrateMessageAttachments(feed);
  } finally {
    feed.removeEventListener("load", keepAtBottom, true);
  }
  scrollMessagesFeedToBottom(feed);

  if (!isGroupChat()) {
    await markIncomingMessagesRead(visibleRows);
  }
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

/** Прокрутка к последнему сообщению с учётом отложенной раскладки flex/картинок. */
function scrollMessagesFeedToBottom(feed) {
  if (!feed) return;
  const pin = () => {
    feed.scrollTop = feed.scrollHeight;
  };
  pin();
  requestAnimationFrame(() => {
    pin();
    requestAnimationFrame(pin);
  });
}

function appendMessagesToFeed(rows) {
  const feed = document.getElementById("messagesFeed");
  if (!feed || !rows.length) return;

  const uid = getCurrentUserId();
  const scoped = isGroupChat()
    ? rows
    : rows.filter((row) => messageBelongsToPeer(row, activePeerId, uid));
  if (!scoped.length) return;

  rememberFeedMessages(scoped);

  const existingIds = getFeedMessageIds();
  const newRows = scoped.filter(
    (row) => !isMessageDeleted(row) && !existingIds.has(String(row.id)),
  );
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
  if (newRows.length && !isGroupChat()) {
    updateLastMessagePeerId(newRows);
  }

  if (atBottom) {
    scrollMessagesFeedToBottom(feed);
  }
  void hydrateMessageAttachments(feed).then(() => {
    if (atBottom || isFeedAtBottom(feed)) {
      scrollMessagesFeedToBottom(feed);
    }
  });
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

  if (isGroupChat()) {
    const groupId = parseGroupId();
    const selectBase = "id, chat_id, sender_id, sender_email, body, created_at";
    let query = supabaseClient
      .from("group_messages")
      .select(withAttachmentColumns(selectBase))
      .eq("chat_id", groupId)
      .order("created_at", { ascending: true });
    if (lastFeedMessageAt) {
      query = query.gte("created_at", lastFeedMessageAt);
    }
    let { data, error } = await query;
    if (error && noteAttachmentSupport(error)) {
      query = supabaseClient
        .from("group_messages")
        .select(withAttachmentColumns(selectBase))
        .eq("chat_id", groupId)
        .order("created_at", { ascending: true });
      if (lastFeedMessageAt) query = query.gte("created_at", lastFeedMessageAt);
      ({ data, error } = await query);
    }
    if (error) {
      if (!noteGroupChatsSupport(error)) {
        console.warn("Ошибка проверки новых сообщений группы:", error);
      }
      return;
    }
    const rows = data || [];
    if (rows.length) {
      appendMessagesToFeed(rows);
    }
    return;
  }

  let query = supabaseClient
    .from("user_messages")
    .select(messageSelectColumns())
    .or(`sender_id.eq.${uid},recipient_id.eq.${uid}`)
    .order("created_at", { ascending: true });

  if (lastFeedMessageAt) {
    query = query.gte("created_at", lastFeedMessageAt);
  }

  let { data, error } = await query;
  if (error && noteAttachmentSupport(error)) {
    let retry = supabaseClient
      .from("user_messages")
      .select(messageSelectColumns())
      .or(`sender_id.eq.${uid},recipient_id.eq.${uid}`)
      .order("created_at", { ascending: true });
    if (lastFeedMessageAt) retry = retry.gte("created_at", lastFeedMessageAt);
    ({ data, error } = await retry);
  }
  if (error && noteDeliveredAtSupport(error) && deliveredAtSupported === false) {
    let retry = supabaseClient
      .from("user_messages")
      .select(messageSelectColumns())
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

  let query = supabaseClient
    .from("user_messages")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", uid)
    .is("read_at", null);
  if (messageActionsSupported !== false) {
    query = query.is("deleted_at", null);
  }

  let { count, error } = await query;

  if (error && noteMessageActionsSupport(error)) {
    ({ count, error } = await supabaseClient
      .from("user_messages")
      .select("id", { count: "exact", head: true })
      .eq("recipient_id", uid)
      .is("read_at", null));
  }

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

/** Однострочное поле по умолчанию; растёт по содержимому до max-height. */
function resizeMessagesComposerInput(input = document.getElementById("messagesComposerInput")) {
  if (!input) return;
  input.style.height = "auto";
  const next = Math.min(Math.max(input.scrollHeight, 0), COMPOSER_INPUT_MAX_HEIGHT_PX);
  input.style.height = `${next}px`;
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
  pendingAttachPhotoToOrder = null;
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
  pendingAttachPhotoToOrder = null;
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
  pendingAttachPhotoToOrder = null;
  activePicker = "order";
  syncPickerButtonStates();
  const orders = filterOrders("", { onlyOpen: true, limit: 0 });
  showOrderSuggestions(mapOrderPickerItems(orders), (item) => applyOrderPick(input, item.order));
  input.focus();
}

function readAttachPhotoMetaFromRow(row) {
  if (!messageHasAttachment(row)) return null;
  const sizeRaw = row.attachment_file_size;
  const fileSize =
    sizeRaw != null && sizeRaw !== "" && Number.isFinite(Number(sizeRaw)) ? Number(sizeRaw) : null;
  return {
    storagePath: String(row.attachment_storage_path || "").trim(),
    thumbnailPath: String(row.attachment_thumbnail_path || "").trim(),
    fileName: String(row.attachment_file_name || "").trim() || "photo.jpg",
    mimeType: String(row.attachment_mime_type || "").trim() || "image/jpeg",
    fileSize,
  };
}

function openAttachPhotoToOrderPicker(meta) {
  if (
    activePicker === "attach-to-order" &&
    pendingAttachPhotoToOrder?.storagePath === meta?.storagePath
  ) {
    hideSuggestions();
    return;
  }
  if (!meta?.storagePath) return;

  const orders = filterOrders("", { onlyOpen: true, limit: 0 });
  if (!orders.length) {
    hideSuggestions();
    const msg = document.getElementById("messagesPageMessage");
    if (msg) {
      msg.textContent = "Нет открытых заказов для прикрепления";
      msg.classList.add("messages-page-message--error");
    }
    return;
  }

  pendingAttachPhotoToOrder = meta;
  activePicker = "attach-to-order";
  syncPickerButtonStates();
  showOrderSuggestions(mapOrderPickerItems(orders), (item) => {
    void attachChatPhotoToSelectedOrder(item.order, meta);
  });
}

async function attachChatPhotoToSelectedOrder(order, meta) {
  const msg = document.getElementById("messagesPageMessage");
  const orderId = order?.id;
  if (!orderId || !meta?.storagePath) return;

  hideSuggestions();
  if (msg) {
    msg.textContent = "Прикрепление фото к заказу…";
    msg.classList.remove("messages-page-message--error");
  }

  try {
    await attachStorageFileToOrder(orderId, meta);
    const chip = formatOrderIdTypeChip(order.id, order.order_type);
    if (msg) {
      msg.textContent = `Фото прикреплено к заказу ${chip}`;
      msg.classList.remove("messages-page-message--error");
    }
  } catch (err) {
    console.error("Ошибка прикрепления фото к заказу:", err);
    if (msg) {
      msg.textContent = err?.message || "Не удалось прикрепить фото к заказу";
      msg.classList.add("messages-page-message--error");
    }
  }
}

function clearPendingChatPhoto() {
  if (pendingChatPhoto?.previewUrl) {
    try {
      URL.revokeObjectURL(pendingChatPhoto.previewUrl);
    } catch {
      /* ignore */
    }
  }
  pendingChatPhoto = null;
  const wrap = document.getElementById("messagesPendingAttachment");
  const thumb = document.getElementById("messagesPendingAttachmentThumb");
  if (thumb) {
    thumb.removeAttribute("src");
    thumb.alt = "";
  }
  if (wrap) wrap.hidden = true;
}

function setPendingChatPhoto(file) {
  clearPendingChatPhoto();
  if (!file) return;
  const previewUrl = URL.createObjectURL(file);
  pendingChatPhoto = { file, previewUrl };
  const wrap = document.getElementById("messagesPendingAttachment");
  const thumb = document.getElementById("messagesPendingAttachmentThumb");
  if (thumb) {
    thumb.src = previewUrl;
    thumb.alt = file.name || "Фото";
  }
  if (wrap) wrap.hidden = false;
}

function setAttachPhotoMenuOpen(open) {
  const menu = document.getElementById("messagesAttachPhotoMenu");
  const btn = document.getElementById("messagesAttachPhotoBtn");
  if (menu) menu.hidden = !open;
  if (btn) {
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.classList.toggle("messages-composer-tool-btn--active", open);
  }
}

function closeAttachPhotoMenu() {
  setAttachPhotoMenuOpen(false);
}

async function handleChatPhotoPicked(fileList) {
  const file = fileList?.[0];
  closeAttachPhotoMenu();
  if (!file) return;

  const msg = document.getElementById("messagesPageMessage");
  if (!file.type?.startsWith("image/")) {
    if (msg) {
      msg.textContent = "Можно прикрепить только изображение.";
      msg.classList.add("messages-page-message--error");
    }
    return;
  }

  const cropped = await cropImageAttachment(file);
  if (cropped === null) return;
  setPendingChatPhoto(cropped);
  if (msg) {
    msg.textContent = "";
    msg.classList.remove("messages-page-message--error");
  }
}

function hideMessageActionMenu() {
  const menu = document.getElementById("messagesActionMenu");
  if (menu) {
    menu.hidden = true;
    menu.style.top = "";
    menu.style.left = "";
  }
  actionMenuMessageId = null;
  actionMenuFromPhoto = false;
  document.querySelector(".message-item--menu-open")?.classList.remove("message-item--menu-open");
}

function clearMessageTextSelection() {
  const selection = window.getSelection?.();
  if (selection && selection.rangeCount > 0) {
    selection.removeAllRanges();
  }
}

function showMessageActionMenu(messageEl, clientX, clientY, { fromPhoto = false } = {}) {
  const menu = document.getElementById("messagesActionMenu");
  if (!menu || !messageEl) return;

  const messageId = messageEl.getAttribute("data-message-id");
  if (!messageId) return;

  const row = feedMessagesById.get(String(messageId));
  if (!row || isMessageDeleted(row)) return;

  const isOwn = messageEl.getAttribute("data-own") === "1";
  actionMenuMessageId = String(messageId);
  actionMenuFromPhoto = Boolean(fromPhoto);

  clearMessageTextSelection();
  requestAnimationFrame(() => {
    clearMessageTextSelection();
    setTimeout(clearMessageTextSelection, 50);
  });

  document.querySelector(".message-item--menu-open")?.classList.remove("message-item--menu-open");
  messageEl.classList.add("message-item--menu-open");

  const replyBtn = menu.querySelector('[data-action="reply"]');
  const editBtn = menu.querySelector('[data-action="edit"]');
  const attachBtn = menu.querySelector('[data-action="attach-to-order"]');
  const deleteBtn = menu.querySelector('[data-action="delete"]');
  if (replyBtn) replyBtn.hidden = false;
  if (editBtn) editBtn.hidden = !isOwn;
  if (attachBtn) attachBtn.hidden = !(actionMenuFromPhoto && messageHasAttachment(row));
  if (deleteBtn) deleteBtn.hidden = !isOwn;

  menu.hidden = false;

  const pad = 8;
  const rect = menu.getBoundingClientRect();
  let left = clientX - rect.width / 2;
  let top = clientY - rect.height - 12;
  left = Math.max(pad, Math.min(left, window.innerWidth - rect.width - pad));
  if (top < pad) top = clientY + 12;
  top = Math.max(pad, Math.min(top, window.innerHeight - rect.height - pad));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function syncComposerContextBar() {
  const bar = document.getElementById("messagesComposerContext");
  const titleEl = document.getElementById("messagesComposerContextTitle");
  const previewEl = document.getElementById("messagesComposerContextPreview");
  const input = document.getElementById("messagesComposerInput");
  if (!bar || !titleEl || !previewEl) return;

  if (composerEditing) {
    bar.hidden = false;
    bar.dataset.mode = "edit";
    titleEl.textContent = "Изменение";
    const preview =
      previewMessageBody(composerEditing.body, composerEditing.recipient_email, composerEditing) ||
      "Сообщение";
    previewEl.textContent = preview;
    if (input) input.placeholder = "Изменить сообщение…";
    return;
  }

  if (composerReplyTo) {
    bar.hidden = false;
    bar.dataset.mode = "reply";
    const uid = getCurrentUserId();
    const isOwn = String(composerReplyTo.sender_id) === String(uid);
    const name =
      displayNameByEmail(composerReplyTo.sender_email) ||
      composerReplyTo.sender_email ||
      "Участник";
    titleEl.textContent = isOwn ? "Ответ себе" : `Ответ: ${name}`;
    const preview =
      previewMessageBody(composerReplyTo.body, composerReplyTo.recipient_email, composerReplyTo) ||
      "Сообщение";
    previewEl.textContent = preview;
    if (input) input.placeholder = "Написать ответ…";
    return;
  }

  bar.hidden = true;
  delete bar.dataset.mode;
  if (input) input.placeholder = "Новое сообщение…";
}

function clearComposerContext() {
  composerReplyTo = null;
  composerEditing = null;
  syncComposerContextBar();
}

function startReplyToMessage(row) {
  if (!row || isMessageDeleted(row)) return;
  if (messageActionsSupported === false) {
    const msg = document.getElementById("messagesPageMessage");
    if (msg) {
      msg.textContent = getMessageActionsSetupHint();
      msg.classList.add("messages-page-message--error");
    }
    return;
  }
  composerEditing = null;
  composerReplyTo = row;
  syncComposerContextBar();
  hideMessageActionMenu();
  const input = document.getElementById("messagesComposerInput");
  input?.focus();
}

function startEditMessage(row) {
  if (!row || isMessageDeleted(row)) return;
  const uid = getCurrentUserId();
  if (String(row.sender_id) !== String(uid)) return;
  if (messageActionsSupported === false) {
    const msg = document.getElementById("messagesPageMessage");
    if (msg) {
      msg.textContent = getMessageActionsSetupHint();
      msg.classList.add("messages-page-message--error");
    }
    return;
  }
  composerReplyTo = null;
  composerEditing = row;
  clearPendingChatPhoto();
  const input = document.getElementById("messagesComposerInput");
  if (input) {
    input.value = String(row.body || "");
    resizeMessagesComposerInput(input);
    input.focus();
    const len = input.value.length;
    input.setSelectionRange(len, len);
  }
  syncComposerContextBar();
  hideMessageActionMenu();
}

function replaceMessageElement(row) {
  const feed = document.getElementById("messagesFeed");
  if (!feed || !row?.id) return;
  rememberFeedMessages([row]);
  const existing = feed.querySelector(`[data-message-id="${row.id}"]`);
  const html = renderMessageItem(row);
  if (!html) {
    existing?.remove();
    if (!feed.querySelector(".message-item")) {
      const emptyText = isGroupChat()
        ? "Пока нет сообщений в этом групповом чате. Напишите первое."
        : "Пока нет сообщений в этой переписке. Напишите первое.";
      feed.innerHTML = `<p class="messages-empty">${emptyText}</p>`;
    }
    return;
  }
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html.trim();
  const next = wrapper.firstElementChild;
  if (!next) return;
  if (existing) {
    existing.replaceWith(next);
  } else {
    feed.querySelector(".messages-empty")?.remove();
    feed.appendChild(next);
  }
  void hydrateMessageAttachments(next);
}

async function deleteOwnMessage(row) {
  if (!row?.id) return;
  const uid = getCurrentUserId();
  if (String(row.sender_id) !== String(uid)) return;

  if (messageActionsSupported === false) {
    const msg = document.getElementById("messagesPageMessage");
    if (msg) {
      msg.textContent = getMessageActionsSetupHint();
      msg.classList.add("messages-page-message--error");
    }
    return;
  }

  const table = isGroupChat() ? "group_messages" : "user_messages";
  const deletedAt = new Date().toISOString();
  const { error } = await supabaseClient
    .from(table)
    .update({ deleted_at: deletedAt })
    .eq("id", row.id)
    .eq("sender_id", uid);

  const msg = document.getElementById("messagesPageMessage");
  if (error) {
    console.error("Ошибка удаления сообщения:", error);
    if (noteMessageActionsSupport(error)) {
      if (msg) {
        msg.textContent = getMessageActionsSetupHint();
        msg.classList.add("messages-page-message--error");
      }
      return;
    }
    if (msg) {
      msg.textContent = "Не удалось удалить сообщение.";
      msg.classList.add("messages-page-message--error");
    }
    return;
  }

  messageActionsSupported = true;
  const updated = { ...row, deleted_at: deletedAt };
  rememberFeedMessages([updated]);
  replaceMessageElement(updated);

  if (composerEditing && String(composerEditing.id) === String(row.id)) {
    composerEditing = null;
    const input = document.getElementById("messagesComposerInput");
    if (input) {
      input.value = "";
      resizeMessagesComposerInput(input);
    }
    syncComposerContextBar();
  }
  if (composerReplyTo && String(composerReplyTo.id) === String(row.id)) {
    composerReplyTo = null;
    syncComposerContextBar();
  }
  hideMessageActionMenu();
}

async function saveEditedMessage() {
  const input = document.getElementById("messagesComposerInput");
  const msg = document.getElementById("messagesPageMessage");
  const sendBtn = document.getElementById("messagesSendBtn");
  if (!input || !composerEditing) return;

  const body = input.value.trim();
  if (!body && !messageHasAttachment(composerEditing)) {
    if (msg) {
      msg.textContent = "Введите текст сообщения.";
      msg.classList.add("messages-page-message--error");
    }
    return;
  }

  const uid = getCurrentUserId();
  if (!uid) return;

  if (messageActionsSupported === false) {
    if (msg) {
      msg.textContent = getMessageActionsSetupHint();
      msg.classList.add("messages-page-message--error");
    }
    return;
  }

  if (sendBtn) sendBtn.disabled = true;
  if (msg) {
    msg.textContent = "";
    msg.classList.remove("messages-page-message--error");
  }

  const editedAt = new Date().toISOString();
  const table = isGroupChat() ? "group_messages" : "user_messages";
  const { data, error } = await supabaseClient
    .from(table)
    .update({ body, edited_at: editedAt })
    .eq("id", composerEditing.id)
    .eq("sender_id", uid)
    .select(isGroupChat()
      ? withMessageActionColumns(withAttachmentColumns("id, chat_id, sender_id, sender_email, body, created_at"))
      : messageSelectColumns())
    .maybeSingle();

  if (sendBtn) sendBtn.disabled = false;

  if (error) {
    console.error("Ошибка изменения сообщения:", error);
    if (noteMessageActionsSupport(error)) {
      if (msg) {
        msg.textContent = getMessageActionsSetupHint();
        msg.classList.add("messages-page-message--error");
      }
      return;
    }
    if (msg) {
      msg.textContent = "Не удалось изменить сообщение.";
      msg.classList.add("messages-page-message--error");
    }
    return;
  }

  messageActionsSupported = true;
  const updated = data || { ...composerEditing, body, edited_at: editedAt };
  replaceMessageElement(updated);
  composerEditing = null;
  input.value = "";
  resizeMessagesComposerInput(input);
  syncComposerContextBar();
}

function cancelLongPress() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  longPressMessageEl = null;
  longPressFromPhoto = false;
}

function onFeedPointerDown(e) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  if (e.target.closest("button, input, textarea")) return;
  if (e.target.closest("a") && !e.target.closest(".message-item-photo-link, .message-item-attachment")) {
    return;
  }
  const item = e.target.closest(".message-item[data-message-id]");
  if (!item) return;

  cancelLongPress();
  longPressTriggered = false;
  longPressMessageEl = item;
  longPressFromPhoto = Boolean(e.target.closest(".message-item-attachment"));
  longPressStartX = e.clientX;
  longPressStartY = e.clientY;

  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    if (!longPressMessageEl) return;
    longPressTriggered = true;
    try {
      longPressMessageEl.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    showMessageActionMenu(longPressMessageEl, longPressStartX, longPressStartY, {
      fromPhoto: longPressFromPhoto,
    });
    longPressMessageEl = null;
  }, LONG_PRESS_MS);
}

function onFeedPointerMove(e) {
  if (!longPressTimer || !longPressMessageEl) return;
  const dx = e.clientX - longPressStartX;
  const dy = e.clientY - longPressStartY;
  if (dx * dx + dy * dy > LONG_PRESS_MOVE_PX * LONG_PRESS_MOVE_PX) {
    cancelLongPress();
  }
}

function onFeedPointerUp() {
  cancelLongPress();
}

function onFeedContextMenu(e) {
  const item = e.target.closest(".message-item[data-message-id]");
  if (!item) return;
  if (e.target.closest("button, input, textarea")) return;
  if (e.target.closest("a") && !e.target.closest(".message-item-photo-link, .message-item-attachment")) {
    return;
  }
  e.preventDefault();
  clearMessageTextSelection();
  showMessageActionMenu(item, e.clientX, e.clientY, {
    fromPhoto: Boolean(e.target.closest(".message-item-attachment")),
  });
}

function onFeedSelectStart(e) {
  if (e.target.closest(".message-item[data-message-id]")) {
    e.preventDefault();
  }
}

function highlightMessageInFeed(messageId) {
  const feed = document.getElementById("messagesFeed");
  const el = feed?.querySelector(`[data-message-id="${messageId}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("message-item--flash");
  setTimeout(() => el.classList.remove("message-item--flash"), 1200);
}

function onMessageActionMenuClick(e) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  const action = btn.getAttribute("data-action");
  const row = actionMenuMessageId ? feedMessagesById.get(String(actionMenuMessageId)) : null;
  hideMessageActionMenu();
  if (!row) return;

  if (action === "reply") {
    startReplyToMessage(row);
  } else if (action === "edit") {
    startEditMessage(row);
  } else if (action === "attach-to-order") {
    const meta = readAttachPhotoMetaFromRow(row);
    if (!meta) return;
    // Открываем после текущего click, иначе document-слушатель сразу закроет список заказов.
    queueMicrotask(() => openAttachPhotoToOrderPicker(meta));
  } else if (action === "delete") {
    void deleteOwnMessage(row);
  }
}

async function sendMessage() {
  if (composerEditing) {
    await saveEditedMessage();
    return;
  }

  const input = document.getElementById("messagesComposerInput");
  const msg = document.getElementById("messagesPageMessage");
  const sendBtn = document.getElementById("messagesSendBtn");
  const attachBtn = document.getElementById("messagesAttachPhotoBtn");
  if (!input) return;

  const body = input.value.trim();
  const photoFile = pendingChatPhoto?.file || null;
  if (!body && !photoFile) return;

  const uid = getCurrentUserId();
  if (!uid) return;

  if (photoFile && attachmentColumnsSupported === false) {
    if (msg) {
      msg.textContent =
        "Фото в чате не настроены. Выполните supabase_message_attachments.sql в Supabase.";
      msg.classList.add("messages-page-message--error");
    }
    return;
  }

  if (sendBtn) sendBtn.disabled = true;
  if (attachBtn) attachBtn.disabled = true;
  if (msg) {
    msg.textContent = "";
    msg.classList.remove("messages-page-message--error");
  }

  let uploaded = null;
  try {
    if (photoFile) {
      uploaded = await uploadChatPhoto(photoFile);
      attachmentColumnsSupported = true;
    }
  } catch (e) {
    console.error("Ошибка загрузки фото сообщения:", e);
    if (sendBtn) sendBtn.disabled = false;
    if (attachBtn) attachBtn.disabled = false;
    if (msg) {
      msg.textContent = e?.message || "Не удалось загрузить фото.";
      msg.classList.add("messages-page-message--error");
    }
    return;
  }

  const attachmentPayload = attachmentFieldsFromUpload(uploaded);

  const cleanupUploadedPhoto = async () => {
    if (!uploaded?.storagePath) return;
    const paths = [uploaded.storagePath];
    if (uploaded.thumbnailPath) paths.push(uploaded.thumbnailPath);
    await supabaseClient.storage.from("order-files").remove(paths).catch(() => {});
  };

  const replyPayload =
    composerReplyTo?.id != null && messageActionsSupported !== false
      ? { reply_to_id: composerReplyTo.id }
      : {};

  if (composerReplyTo && messageActionsSupported === false) {
    await cleanupUploadedPhoto();
    if (sendBtn) sendBtn.disabled = false;
    if (attachBtn) attachBtn.disabled = false;
    if (msg) {
      msg.textContent = getMessageActionsSetupHint();
      msg.classList.add("messages-page-message--error");
    }
    return;
  }

  if (isGroupChat()) {
    const groupId = parseGroupId();
    if (!groupId) {
      await cleanupUploadedPhoto();
      if (sendBtn) sendBtn.disabled = false;
      if (attachBtn) attachBtn.disabled = false;
      if (msg) {
        msg.textContent = "Не удалось определить групповой чат.";
        msg.classList.add("messages-page-message--error");
      }
      return;
    }

    const { error } = await supabaseClient.from("group_messages").insert({
      chat_id: groupId,
      sender_id: uid,
      sender_email: getCurrentUserEmail(),
      body,
      ...attachmentPayload,
      ...replyPayload,
    });

    if (sendBtn) sendBtn.disabled = false;
    if (attachBtn) attachBtn.disabled = false;

    if (error) {
      console.error("Ошибка отправки сообщения в группу:", error);
      await cleanupUploadedPhoto();
      if (noteMessageActionsSupport(error) && replyPayload.reply_to_id != null) {
        if (msg) {
          msg.textContent = getMessageActionsSetupHint();
          msg.classList.add("messages-page-message--error");
        }
        return;
      }
      if (noteAttachmentSupport(error)) {
        if (msg) {
          msg.textContent =
            "Фото в чате не настроены. Выполните supabase_message_attachments.sql в Supabase.";
          msg.classList.add("messages-page-message--error");
        }
        return;
      }
      if (msg) {
        msg.textContent = noteGroupChatsSupport(error)
          ? "Групповые чаты не настроены. Выполните supabase_group_chats.sql в Supabase."
          : "Не удалось отправить сообщение.";
        msg.classList.add("messages-page-message--error");
      }
      return;
    }

    input.value = "";
    resizeMessagesComposerInput(input);
    clearPendingChatPhoto();
    composerReplyTo = null;
    syncComposerContextBar();
    hideSuggestions();
    await loadMessages();
    return;
  }

  const users = await loadUsersDirectory();

  if (isPeerChat()) {
    const peer = users.find((u) => String(u.id) === String(activePeerId));
    if (!peer) {
      await cleanupUploadedPhoto();
      if (sendBtn) sendBtn.disabled = false;
      if (attachBtn) attachBtn.disabled = false;
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
    await cleanupUploadedPhoto();
    if (sendBtn) sendBtn.disabled = false;
    if (attachBtn) attachBtn.disabled = false;
    if (msg) {
      msg.textContent = isPeerChat()
        ? "Не удалось определить получателя."
        : "Выберите получателя кнопкой с человечком.";
      msg.classList.add("messages-page-message--error");
    }
    return;
  }

  const senderEmail = getCurrentUserEmail();
  const inserts = recipientList.map((recipient) => ({
    sender_id: uid,
    recipient_id: recipient.id,
    sender_email: senderEmail,
    recipient_email: recipient.email,
    body,
    ...attachmentPayload,
    ...replyPayload,
  }));

  const { error } = await supabaseClient.from("user_messages").insert(inserts);

  if (sendBtn) sendBtn.disabled = false;
  if (attachBtn) attachBtn.disabled = false;

  if (error) {
    console.error("Ошибка отправки сообщения:", error);
    await cleanupUploadedPhoto();
    if (noteMessageActionsSupport(error) && replyPayload.reply_to_id != null) {
      if (msg) {
        msg.textContent = getMessageActionsSetupHint();
        msg.classList.add("messages-page-message--error");
      }
      return;
    }
    if (noteAttachmentSupport(error)) {
      if (msg) {
        msg.textContent =
          "Фото в чате не настроены. Выполните supabase_message_attachments.sql в Supabase.";
        msg.classList.add("messages-page-message--error");
      }
      return;
    }
    if (msg) {
      msg.textContent = "Не удалось отправить сообщение.";
      msg.classList.add("messages-page-message--error");
    }
    return;
  }

  input.value = "";
  resizeMessagesComposerInput(input);
  clearPendingChatPhoto();
  composerReplyTo = null;
  syncComposerContextBar();
  if (!isPeerChat()) {
    composerRecipients.clear();
  }
  hideSuggestions();
  await loadMessages();
}

function onFeedClick(e) {
  if (longPressTriggered) {
    longPressTriggered = false;
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  const replyQuote = e.target.closest(".message-item-reply[data-reply-to-id]");
  if (replyQuote) {
    e.preventDefault();
    const replyId = replyQuote.getAttribute("data-reply-to-id");
    if (replyId) highlightMessageInFeed(replyId);
    return;
  }

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

function setCreateGroupError(text) {
  const el = document.getElementById("messagesCreateGroupError");
  if (!el) return;
  if (text) {
    el.textContent = text;
    el.hidden = false;
  } else {
    el.textContent = "";
    el.hidden = true;
  }
}

function closeCreateGroupDialog() {
  const dialog = document.getElementById("messagesCreateGroupDialog");
  if (dialog?.open) dialog.close();
  setCreateGroupError("");
}

async function openCreateGroupDialog() {
  const dialog = document.getElementById("messagesCreateGroupDialog");
  const nameInput = document.getElementById("messagesCreateGroupName");
  const usersEl = document.getElementById("messagesCreateGroupUsers");
  if (!dialog || !usersEl) return;

  setCreateGroupError("");
  if (nameInput) nameInput.value = "";

  const users = await loadUsersDirectory();
  const uid = getCurrentUserId();
  const others = (users || []).filter((u) => String(u.id) !== String(uid));

  usersEl.innerHTML = others.length
    ? others
        .map((user) => {
          const name = displayNameByEmail(user.email) || user.email || "—";
          return `
            <label class="messages-create-group-user">
              <input type="checkbox" value="${escapeHtml(user.id)}" data-email="${escapeHtml(user.email)}" />
              <span class="messages-create-group-user-name">${escapeHtml(name)}</span>
            </label>
          `;
        })
        .join("")
    : `<p class="messages-page-message">Нет доступных пользователей.</p>`;

  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
  nameInput?.focus();
}

async function saveCreateGroupChat() {
  const nameInput = document.getElementById("messagesCreateGroupName");
  const usersEl = document.getElementById("messagesCreateGroupUsers");
  const saveBtn = document.getElementById("messagesCreateGroupSaveBtn");
  const uid = getCurrentUserId();
  if (!uid || !nameInput || !usersEl) return;

  const name = nameInput.value.trim();
  if (!name) {
    setCreateGroupError("Укажите название группового чата.");
    nameInput.focus();
    return;
  }

  const selectedIds = [...usersEl.querySelectorAll('input[type="checkbox"]:checked')].map((input) =>
    String(input.value),
  );
  if (!selectedIds.length) {
    setCreateGroupError("Выберите хотя бы одного участника.");
    return;
  }

  const memberIds = [...new Set([uid, ...selectedIds])];

  if (saveBtn) saveBtn.disabled = true;
  setCreateGroupError("");

  const { data, error } = await supabaseClient
    .from("group_chats")
    .insert({
      name,
      created_by: uid,
      member_ids: memberIds,
    })
    .select("id, name, created_by, member_ids, created_at")
    .single();

  if (saveBtn) saveBtn.disabled = false;

  if (error) {
    console.error("Ошибка создания группового чата:", error);
    setCreateGroupError(
      noteGroupChatsSupport(error)
        ? "Таблицы групповых чатов не созданы. Выполните supabase_group_chats.sql в Supabase."
        : "Не удалось создать групповой чат.",
    );
    return;
  }

  const chat = {
    id: String(data.id),
    name: String(data.name || name).trim() || name,
    created_by: data.created_by,
    memberIds: (data.member_ids || memberIds).map(String),
    created_at: data.created_at,
  };
  groupChatsById.set(chat.id, chat);
  groupChatsSupported = true;

  closeCreateGroupDialog();
  await openMessagesDialog(toGroupPeerId(chat.id));
}

export function initMessagesSection() {
  const navBtn = document.getElementById("messagesNavBtn");
  const sendBtn = document.getElementById("messagesSendBtn");
  const input = document.getElementById("messagesComposerInput");
  const feed = document.getElementById("messagesFeed");
  const chatList = document.getElementById("messagesChatList");
  const backBtn = document.getElementById("messagesBackBtn");
  const createGroupBtn = document.getElementById("messagesCreateGroupBtn");
  const createGroupDialog = document.getElementById("messagesCreateGroupDialog");
  const createGroupSaveBtn = document.getElementById("messagesCreateGroupSaveBtn");
  const createGroupCancelBtn = document.getElementById("messagesCreateGroupCancelBtn");
  const createGroupCloseBtn = document.getElementById("messagesCreateGroupCloseBtn");

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

  if (createGroupBtn) {
    createGroupBtn.addEventListener("click", () => {
      void openCreateGroupDialog();
    });
  }

  if (createGroupSaveBtn) {
    createGroupSaveBtn.addEventListener("click", () => {
      void saveCreateGroupChat();
    });
  }

  if (createGroupCancelBtn) {
    createGroupCancelBtn.addEventListener("click", () => {
      closeCreateGroupDialog();
    });
  }

  if (createGroupCloseBtn) {
    createGroupCloseBtn.addEventListener("click", () => {
      closeCreateGroupDialog();
    });
  }

  if (createGroupDialog) {
    createGroupDialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      closeCreateGroupDialog();
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener("click", () => void sendMessage());
  }

  const msgEl = document.getElementById("messagesPageMessage");
  if (feed) {
    feed.addEventListener("click", onFeedClick);
    feed.addEventListener("pointerdown", onFeedPointerDown);
    feed.addEventListener("pointermove", onFeedPointerMove);
    feed.addEventListener("pointerup", onFeedPointerUp);
    feed.addEventListener("pointercancel", onFeedPointerUp);
    feed.addEventListener("contextmenu", onFeedContextMenu);
    feed.addEventListener("selectstart", onFeedSelectStart);
  }

  const actionMenu = document.getElementById("messagesActionMenu");
  if (actionMenu) {
    actionMenu.addEventListener("click", onMessageActionMenuClick);
  }

  const contextCloseBtn = document.getElementById("messagesComposerContextClose");
  if (contextCloseBtn) {
    contextCloseBtn.addEventListener("click", () => {
      if (composerEditing) {
        const inputEl = document.getElementById("messagesComposerInput");
        if (inputEl) {
          inputEl.value = "";
          resizeMessagesComposerInput(inputEl);
        }
      }
      composerReplyTo = null;
      composerEditing = null;
      syncComposerContextBar();
    });
  }

  const userPickBtn = document.getElementById("messagesPickUserBtn");
  const orderPickBtn = document.getElementById("messagesPickOrderBtn");
  const attachPhotoBtn = document.getElementById("messagesAttachPhotoBtn");
  const attachPhotoMenu = document.getElementById("messagesAttachPhotoMenu");
  const attachGalleryBtn = document.getElementById("messagesAttachPhotoGalleryBtn");
  const attachCameraBtn = document.getElementById("messagesAttachPhotoCameraBtn");
  const galleryInput = document.getElementById("messagesPhotoGalleryInput");
  const cameraInput = document.getElementById("messagesPhotoCameraInput");
  const pendingRemoveBtn = document.getElementById("messagesPendingAttachmentRemove");

  if (userPickBtn && input) {
    userPickBtn.addEventListener("mousedown", (e) => e.preventDefault());
    userPickBtn.addEventListener("click", () => {
      if (isPeerChat() || isGroupChat()) return;
      void loadUsersDirectory().then(() => openUserPicker(input));
    });
  }

  if (orderPickBtn && input) {
    orderPickBtn.addEventListener("mousedown", (e) => e.preventDefault());
    orderPickBtn.addEventListener("click", () => openOrderPicker(input));
  }

  if (attachPhotoBtn) {
    attachPhotoBtn.addEventListener("mousedown", (e) => e.preventDefault());
    attachPhotoBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (composerEditing) return;
      const menu = document.getElementById("messagesAttachPhotoMenu");
      const open = Boolean(menu && menu.hidden);
      setAttachPhotoMenuOpen(open);
      if (open) hideSuggestions();
    });
  }

  if (attachGalleryBtn && galleryInput) {
    attachGalleryBtn.addEventListener("click", () => {
      closeAttachPhotoMenu();
      galleryInput.value = "";
      galleryInput.click();
    });
  }

  if (attachCameraBtn && cameraInput) {
    attachCameraBtn.addEventListener("click", () => {
      closeAttachPhotoMenu();
      cameraInput.value = "";
      cameraInput.click();
    });
  }

  if (galleryInput) {
    galleryInput.addEventListener("change", () => {
      void handleChatPhotoPicked(galleryInput.files);
      galleryInput.value = "";
    });
  }

  if (cameraInput) {
    cameraInput.addEventListener("change", () => {
      void handleChatPhotoPicked(cameraInput.files);
      cameraInput.value = "";
    });
  }

  if (pendingRemoveBtn) {
    pendingRemoveBtn.addEventListener("click", () => {
      clearPendingChatPhoto();
    });
  }

  document.addEventListener("click", (e) => {
    const menu = document.getElementById("messagesActionMenu");
    if (menu && !menu.hidden && !menu.contains(e.target) && !e.target.closest(".message-item--menu-open")) {
      hideMessageActionMenu();
    }

    const wrap = document.querySelector(".messages-attach-photo-wrap");
    if (!wrap || wrap.contains(e.target)) {
      /* keep menu if click is inside wrap; still may close order attach picker below */
    } else if (attachPhotoMenu && !attachPhotoMenu.hidden) {
      closeAttachPhotoMenu();
    }

    if (activePicker === "attach-to-order") {
      const suggestions = document.getElementById("messagesComposerSuggestions");
      const onSuggestions = suggestions && !suggestions.hidden && suggestions.contains(e.target);
      const onActionMenu = Boolean(e.target.closest("#messagesActionMenu"));
      if (!onSuggestions && !onActionMenu) {
        hideSuggestions();
      }
    }
  });

  document.addEventListener("scroll", () => {
    if (document.getElementById("messagesActionMenu") && !document.getElementById("messagesActionMenu").hidden) {
      hideMessageActionMenu();
    }
  }, true);

  if (input) {
    let debounceTimer = null;
    resizeMessagesComposerInput(input);
    input.addEventListener("input", () => {
      resizeMessagesComposerInput(input);
      if (msgEl) msgEl.classList.remove("messages-page-message--error");
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void loadUsersDirectory().then(() => updateComposerSuggestions(input));
      }, SUGGEST_DEBOUNCE_MS);
    });

    input.addEventListener("keydown", (e) => {
      const list = document.getElementById("messagesComposerSuggestions");
      // Enter вставляет новую строку (как в мессенджерах); отправка — кнопкой.
      if (!list || list.hidden) return;

      if (list.classList.contains("messages-suggestions--recipients")) {
        if (e.key === "Escape") hideSuggestions();
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

export { ORDER_TOKEN_RE, GROUP_PEER_PREFIX };
