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
  isCroppableImageFile,
  uploadChatPhoto,
} from "./files.js";
import { fetchAllSupabaseRows } from "./supabase-fetch.js";

const ORDER_TOKEN_RE = /\[\[order:(\d+)\]\]/g;
/** Максимальная высота поля ввода сообщения (как в CSS max-height). */
const COMPOSER_INPUT_MAX_HEIGHT_PX = 120;
const SUGGEST_DEBOUNCE_MS = 120;
const UNREAD_POLL_MS = 60_000;
const FEED_POLL_MS = 15_000;
const CHAT_LIST_POLL_MS = 20_000;
/** Сколько недавних DM тянуть для превью списка чатов (не всю историю). */
const CHAT_LIST_DM_PREVIEW_LIMIT = 800;
/** Первый проход списка чатов: только недавние DM за MESSAGES_FAST_LOAD_DAYS. */
const CHAT_LIST_FAST_PREVIEW_LIMIT = 200;
/** Снимок отрисованного списка: js/chat-boot.js показывает его до загрузки модулей. */
const CHAT_LIST_SNAPSHOT_KEY = "orders_site_chat_list_snapshot_v1";
/** Больше одного экрана не нужно — не раздуваем localStorage. */
const CHAT_LIST_SNAPSHOT_MAX_ITEMS = 20;
/** Сколько последних сообщений диалога грузить сразу. */
const DIALOG_MESSAGE_LIMIT = 400;
/** Первая отрисовка списка/диалога: только сообщения за последние N дней. */
const MESSAGES_FAST_LOAD_DAYS = 3;
/** Префикс peer id для группового чата. */
const GROUP_PEER_PREFIX = "group:";
const ATTACHMENT_SELECT_COLS =
  "attachment_storage_path, attachment_thumbnail_path, attachment_mime_type, attachment_file_name, attachment_file_size";
const ATTACHMENT_DIMENSION_COLS = "attachment_width, attachment_height";
/** Максимальный CSS-слот фото в пузыре (должен совпадать со style.css). */
const CHAT_PHOTO_MAX_W = 240;
const CHAT_PHOTO_MAX_H = 280;
/** Фиксированный слот без известных размеров — никогда не растёт после load. */
const CHAT_PHOTO_FALLBACK_RATIO = `${CHAT_PHOTO_MAX_W} / ${CHAT_PHOTO_MAX_H}`;

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
/** @type {Map<string, { id: string, name: string, memberIds: string[], avatarStoragePath?: string|null, created_at?: string, created_by?: string }>} */
let groupChatsById = new Map();
/** @type {Map<string, { id: string, email: string }>} */
let composerRecipients = new Map();
let activePicker = null;
/** null = unknown, true/false after first probe */
let deliveredAtSupported = null;
/** null = unknown, true/false after first probe */
let groupChatsSupported = null;
/** null = unknown, true/false after first probe — avatar_storage_path on group_chats */
let groupAvatarSupported = null;
/** Кэш подписанных URL аватаров групп — один и тот же URL при перерисовке списка, без мигания буквы. */
/** @type {Map<string, { url: string, expiresAt: number }>} */
const groupAvatarUrlCache = new Map();
const GROUP_AVATAR_URL_CACHE_MS = 9 * 60 * 1000;
/** URL групповых аватаров, уже загруженных в память браузера. */
const groupAvatarImageReady = new Set();
const staticAvatarImageReady = new Set();
/** null = unknown, true/false after first probe — group_chat_reads table */
let groupChatReadsSupported = null;
/** null = unknown, true/false after first probe — last_delivered_at on group_chat_reads */
let groupDeliveredAtSupported = null;
/**
 * Статусы участников активного группового диалога.
 * @type {Map<string, { lastReadAt: string|null, lastDeliveredAt: string|null }>}
 */
let activeGroupReceiptsByUser = new Map();
/** null = unknown, true/false after first probe */
let attachmentColumnsSupported = null;
/** null = неизвестно, true/false = колонки attachment_width/height доступны. */
let attachmentDimensionColumnsSupported = null;
/** null = unknown, true/false after first probe — reply_to_id / edited_at / deleted_at */
let messageActionsSupported = null;
/** @type {"create" | "edit"} */
let groupFormMode = "create";
/** @type {string | null} */
let editingGroupId = null;
/** @type {File | null} */
let groupFormAvatarFile = null;
/** @type {string | null} object URL for local preview */
let groupFormAvatarObjectUrl = null;
/** Existing storage path when editing; null if none / cleared */
let groupFormAvatarExistingPath = null;
let groupFormAvatarRemoved = false;
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
/** timestamp открытия меню — игнор ghost-click/scroll сразу после long-press (iOS) */
let actionMenuOpenedAt = 0;
/** пока палец на пункте меню — не закрывать меню из scroll/outside-click */
let actionMenuPointerDown = false;
/**
 * Запоминаем действие на pointerdown, выполняем на pointerup —
 * click на iOS после long-press иногда теряется или приходит уже после hide.
 * @type {{ action: string, messageId: string, pointerId: number } | null}
 */
let actionMenuArmed = null;
/** защита от двойного срабатывания pointerup + click */
let actionMenuHandledAt = 0;
let longPressTimer = null;
let longPressMessageEl = null;
let longPressStartX = 0;
let longPressStartY = 0;
let longPressTriggered = false;
let longPressFromPhoto = false;
const LONG_PRESS_MS = 480;
const LONG_PRESS_MOVE_PX = 12;
/** После показа меню игнорим outside-click/scroll (отпускание пальца / micro-scroll iOS). */
const ACTION_MENU_DISMISS_GRACE_MS = 450;
const ACTION_MENU_ACTION_DEDUP_MS = 500;

const MESSAGE_ACTION_COLS = "reply_to_id, edited_at, deleted_at";
const MESSAGE_SELECT_WITH_DELIVERED =
  "id, sender_id, recipient_id, sender_email, recipient_email, body, created_at, read_at, delivered_at";
const MESSAGE_SELECT_BASIC =
  "id, sender_id, recipient_id, sender_email, recipient_email, body, created_at, read_at";

function withAttachmentColumns(base) {
  if (attachmentColumnsSupported === false) return base;
  if (attachmentDimensionColumnsSupported === false) {
    return `${base}, ${ATTACHMENT_SELECT_COLS}`;
  }
  return `${base}, ${ATTACHMENT_SELECT_COLS}, ${ATTACHMENT_DIMENSION_COLS}`;
}

function withMessageActionColumns(base) {
  if (messageActionsSupported === false) return base;
  return `${base}, ${MESSAGE_ACTION_COLS}`;
}

function messageSelectColumns() {
  const base = deliveredAtSupported === false ? MESSAGE_SELECT_BASIC : MESSAGE_SELECT_WITH_DELIVERED;
  return withMessageActionColumns(withAttachmentColumns(base));
}

/** Лёгкий набор колонок для превью в списке чатов (без вложений и метаданных ответов). */
function chatListPreviewSelectColumns() {
  const base =
    deliveredAtSupported === false ? MESSAGE_SELECT_BASIC : MESSAGE_SELECT_WITH_DELIVERED;
  let cols = base;
  if (messageActionsSupported !== false) cols += ", deleted_at";
  if (attachmentColumnsSupported !== false) cols += ", attachment_storage_path";
  return cols;
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

function noteAttachmentDimensionSupport(error) {
  if (!error) {
    if (attachmentDimensionColumnsSupported !== false) attachmentDimensionColumnsSupported = true;
    return false;
  }
  const msg = `${error.message || ""} ${error.details || ""} ${error.hint || ""} ${error.code || ""}`.toLowerCase();
  if (msg.includes("attachment_width") || msg.includes("attachment_height")) {
    attachmentDimensionColumnsSupported = false;
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
  activeGroupReceiptsByUser = new Map();
}

function getMessageActionsSetupHint() {
  return "Действия с сообщениями не настроены. Выполните supabase_message_actions.sql в Supabase.";
}

function messageHasAttachment(row) {
  return Boolean(row?.attachment_storage_path);
}

function attachmentFieldsFromUpload(uploaded) {
  if (!uploaded) return {};
  const fields = {
    attachment_storage_path: uploaded.storagePath,
    attachment_thumbnail_path: uploaded.thumbnailPath,
    attachment_mime_type: uploaded.mimeType,
    attachment_file_name: uploaded.fileName,
    attachment_file_size: uploaded.fileSize,
  };
  if (attachmentDimensionColumnsSupported === false) return fields;
  const width = Number(uploaded.width);
  const height = Number(uploaded.height);
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    fields.attachment_width = Math.round(width);
    fields.attachment_height = Math.round(height);
  }
  return fields;
}

function stripAttachmentDimensionFields(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const next = { ...payload };
  delete next.attachment_width;
  delete next.attachment_height;
  return next;
}

/** CSS-слот фото в пузыре. Без известных размеров — сразу max 240×280 (без роста после load). */
function chatPhotoSlotSize(naturalW, naturalH) {
  const nw = Number(naturalW);
  const nh = Number(naturalH);
  if (!Number.isFinite(nw) || !Number.isFinite(nh) || nw <= 0 || nh <= 0) {
    return {
      width: CHAT_PHOTO_MAX_W,
      height: CHAT_PHOTO_MAX_H,
      ratio: CHAT_PHOTO_FALLBACK_RATIO,
    };
  }
  const scale = Math.min(CHAT_PHOTO_MAX_W / nw, CHAT_PHOTO_MAX_H / nh, 1);
  const width = Math.max(1, Math.round(nw * scale));
  const height = Math.max(1, Math.round(nh * scale));
  return { width, height, ratio: `${width} / ${height}` };
}

function chatPhotoSlotStyleAttr(naturalW, naturalH) {
  const slot = chatPhotoSlotSize(naturalW, naturalH);
  return `style="width:min(100%,${slot.width}px);aspect-ratio:${slot.ratio};height:auto"`;
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
  // Не путать отсутствие group_chat_reads с отсутствием самих групповых чатов.
  if (msg.includes("group_chat_reads")) return false;
  if (
    msg.includes("group_chats") ||
    msg.includes("group_messages") ||
    error.code === "42P01" ||
    error.code === "PGRST205"
  ) {
    groupChatsSupported = false;
    return true;
  }
  return false;
}

function noteGroupAvatarSupport(error) {
  if (!error) {
    groupAvatarSupported = true;
    return false;
  }
  const msg = `${error.message || ""} ${error.details || ""} ${error.hint || ""} ${error.code || ""}`.toLowerCase();
  if (
    msg.includes("avatar_storage_path") ||
    (error.code === "PGRST204" && msg.includes("avatar"))
  ) {
    groupAvatarSupported = false;
    return true;
  }
  return false;
}

function noteGroupChatReadsSupport(error) {
  if (!error) {
    groupChatReadsSupported = true;
    return false;
  }
  const msg = `${error.message || ""} ${error.details || ""} ${error.hint || ""} ${error.code || ""}`.toLowerCase();
  if (
    msg.includes("group_chat_reads") ||
    error.code === "42P01" ||
    error.code === "PGRST205"
  ) {
    groupChatReadsSupported = false;
    return true;
  }
  return false;
}

function noteGroupDeliveredAtSupport(error) {
  if (!error) {
    groupDeliveredAtSupported = true;
    return false;
  }
  const msg = `${error.message || ""} ${error.details || ""} ${error.hint || ""} ${error.code || ""}`.toLowerCase();
  if (
    msg.includes("last_delivered_at") ||
    error.code === "PGRST204" ||
    error.code === "42703"
  ) {
    groupDeliveredAtSupported = false;
    return true;
  }
  return false;
}

function groupReceiptSelectColumns() {
  if (groupDeliveredAtSupported === false) return "chat_id, user_id, last_read_at";
  return "chat_id, user_id, last_read_at, last_delivered_at";
}

function mapGroupReceiptRow(row) {
  return {
    lastReadAt: row?.last_read_at ? String(row.last_read_at) : null,
    lastDeliveredAt: row?.last_delivered_at ? String(row.last_delivered_at) : null,
  };
}

/** Доставлено/прочитано участником относительно created_at сообщения. */
function memberReceiptState(messageCreatedAt, receipt) {
  const created = String(messageCreatedAt || "");
  if (!created) {
    return { read: false, delivered: false, status: "sent" };
  }
  const readAt = receipt?.lastReadAt || null;
  const deliveredAt = receipt?.lastDeliveredAt || null;
  const read = Boolean(readAt && readAt >= created);
  const delivered = read || Boolean(deliveredAt && deliveredAt >= created);
  if (read) return { read: true, delivered: true, status: "read" };
  if (delivered) return { read: false, delivered: true, status: "delivered" };
  return { read: false, delivered: false, status: "sent" };
}

function groupOtherMemberIds(memberIds, senderId, uid = getCurrentUserId()) {
  const me = String(uid || "");
  const sender = String(senderId || me);
  return (memberIds || [])
    .map(String)
    .filter((id) => id && id !== me && id !== sender);
}

/**
 * Агрегат для списка чатов: две галочки — все прочитали; одна — все получили;
 * иначе пусто (пока не все получили).
 */
function aggregateGroupOutgoingListStatus(messageCreatedAt, memberIds, receiptsByUser, senderId) {
  const others = groupOtherMemberIds(memberIds, senderId);
  if (!others.length) return null;
  let allDelivered = true;
  let allRead = true;
  for (const memberId of others) {
    const state = memberReceiptState(messageCreatedAt, receiptsByUser?.get(String(memberId)));
    if (!state.delivered) allDelivered = false;
    if (!state.read) allRead = false;
  }
  if (allRead) return "read";
  if (allDelivered) return "delivered";
  return null;
}

function resolveMemberLabel(memberId) {
  const user = (usersCache || []).find((u) => String(u.id) === String(memberId));
  const email = user?.email || "";
  const name = displayNameByEmail(email) || email || "Участник";
  return { name, email, letter: avatarInitial(name) };
}

function groupParticipantReceiptLabel(name, state) {
  if (state.read) return `${name}: прочитано`;
  if (state.delivered) return `${name}: доставлено`;
  return `${name}: не получено`;
}

/** Буква имени + 0/1/2 галочки для каждого участника (кроме отправителя). */
function renderGroupParticipantReceiptsHtml(messageCreatedAt, memberIds, receiptsByUser, senderId) {
  const others = groupOtherMemberIds(memberIds, senderId);
  if (!others.length) return "";

  const sorted = others
    .map((memberId) => {
      const { name, letter } = resolveMemberLabel(memberId);
      const state = memberReceiptState(messageCreatedAt, receiptsByUser?.get(String(memberId)));
      return { name, letter, state };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

  const html = sorted
    .map(({ name, letter, state }) => {
      const label = groupParticipantReceiptLabel(name, state);
      let ticksHtml = "";
      if (state.read) {
        ticksHtml = `<span class="message-item-ticks message-item-ticks--read" aria-hidden="true">${TICK_SVG_DOUBLE}</span>`;
      } else if (state.delivered) {
        ticksHtml = `<span class="message-item-ticks message-item-ticks--delivered" aria-hidden="true">${TICK_SVG_SINGLE}</span>`;
      }
      const noneClass = state.delivered || state.read ? "" : " message-item-group-receipt--pending";
      return `<span class="message-item-group-receipt${noneClass}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"><span class="message-item-group-receipt-letter">${escapeHtml(letter)}</span>${ticksHtml}</span>`;
    })
    .join("");

  return `<span class="message-item-group-receipts">${html}</span>`;
}

function mergeLaterReadAt(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return a >= b ? a : b;
}

/** last_read_at по chat_id: только сервер (Supabase). */
async function fetchGroupChatReads(chatIds) {
  const uid = getCurrentUserId();
  const result = new Map();
  if (!uid || !chatIds?.length) return result;

  if (groupChatReadsSupported === false) return result;

  const { data, error } = await supabaseClient
    .from("group_chat_reads")
    .select("chat_id, last_read_at")
    .eq("user_id", uid)
    .in("chat_id", chatIds);

  if (error) {
    if (noteGroupChatReadsSupport(error)) return result;
    console.warn("Не удалось загрузить прочитанность групповых чатов:", error);
    return result;
  }

  groupChatReadsSupported = true;
  for (const row of data || []) {
    const chatId = String(row.chat_id);
    const at = row.last_read_at ? String(row.last_read_at) : null;
    if (!chatId || !at) continue;
    result.set(chatId, at);
  }
  return result;
}

/** Своя прочитанность из уже загруженных статусов участников — без отдельного запроса. */
function ownReadsFromGroupReceipts(receiptsByChat, uid) {
  const result = new Map();
  if (!uid) return result;
  for (const [chatId, byUser] of receiptsByChat || []) {
    const at = byUser?.get(String(uid))?.lastReadAt;
    if (at) result.set(String(chatId), String(at));
  }
  return result;
}

async function markGroupChatRead(chatId, at = new Date().toISOString()) {
  const uid = getCurrentUserId();
  if (!uid || !chatId) return;
  if (groupChatReadsSupported === false) return;

  const payload = {
    chat_id: chatId,
    user_id: uid,
    last_read_at: at,
  };
  if (groupDeliveredAtSupported !== false) {
    payload.last_delivered_at = at;
  }

  const { error } = await supabaseClient.from("group_chat_reads").upsert(payload, {
    onConflict: "chat_id,user_id",
  });

  if (error) {
    if (noteGroupChatReadsSupport(error)) return;
    if (noteGroupDeliveredAtSupport(error) && groupDeliveredAtSupported === false) {
      const retry = await supabaseClient.from("group_chat_reads").upsert(
        {
          chat_id: chatId,
          user_id: uid,
          last_read_at: at,
        },
        { onConflict: "chat_id,user_id" },
      );
      if (retry.error) {
        if (!noteGroupChatReadsSupport(retry.error)) {
          console.warn("Не удалось отметить групповой чат прочитанным:", retry.error);
        }
        return;
      }
      groupChatReadsSupported = true;
      return;
    }
    console.warn("Не удалось отметить групповой чат прочитанным:", error);
  } else {
    groupChatReadsSupported = true;
    if (groupDeliveredAtSupported !== false) groupDeliveredAtSupported = true;
  }
}

/**
 * Отметить доставку групповых сообщений без прочтения.
 * Не затирает last_read_at: сначала UPDATE, при отсутствии строки — INSERT с epoch.
 */
async function markGroupChatDelivered(chatId, at = new Date().toISOString()) {
  const uid = getCurrentUserId();
  if (!uid || !chatId || groupChatReadsSupported === false || groupDeliveredAtSupported === false) {
    return;
  }

  const selectCols = groupReceiptSelectColumns();
  let { data: existing, error: selectError } = await supabaseClient
    .from("group_chat_reads")
    .select(selectCols)
    .eq("chat_id", chatId)
    .eq("user_id", uid)
    .maybeSingle();

  if (selectError) {
    if (noteGroupChatReadsSupport(selectError)) return;
    if (noteGroupDeliveredAtSupport(selectError) && groupDeliveredAtSupported === false) return;
    console.warn("Не удалось проверить доставку группового чата:", selectError);
    return;
  }

  groupChatReadsSupported = true;
  if (groupDeliveredAtSupported !== false) groupDeliveredAtSupported = true;

  const prevDelivered = existing?.last_delivered_at ? String(existing.last_delivered_at) : null;
  const nextDelivered = mergeLaterReadAt(prevDelivered, at) || at;
  if (prevDelivered && prevDelivered >= nextDelivered) return;

  if (existing) {
    const { error } = await supabaseClient
      .from("group_chat_reads")
      .update({ last_delivered_at: nextDelivered })
      .eq("chat_id", chatId)
      .eq("user_id", uid);
    if (error) {
      if (noteGroupDeliveredAtSupport(error)) return;
      if (!noteGroupChatReadsSupport(error)) {
        console.warn("Не удалось отметить доставку группового чата:", error);
      }
    }
    return;
  }

  // Новая строка: last_read_at = epoch, чтобы не считать чат прочитанным.
  const { error: insertError } = await supabaseClient.from("group_chat_reads").insert({
    chat_id: chatId,
    user_id: uid,
    last_read_at: "1970-01-01T00:00:00.000Z",
    last_delivered_at: nextDelivered,
  });

  if (insertError) {
    if (noteGroupDeliveredAtSupport(insertError)) return;
    if (!noteGroupChatReadsSupport(insertError)) {
      console.warn("Не удалось создать статус доставки группового чата:", insertError);
    }
  }
}

/** Статусы всех участников по списку чатов: Map<chatId, Map<userId, receipt>> */
async function fetchGroupMemberReceiptsByChat(chatIds) {
  const byChat = new Map();
  if (!chatIds?.length || groupChatReadsSupported === false) return byChat;

  let select = groupReceiptSelectColumns();
  let { data, error } = await supabaseClient
    .from("group_chat_reads")
    .select(select)
    .in("chat_id", chatIds);

  if (error && noteGroupDeliveredAtSupport(error) && groupDeliveredAtSupported === false) {
    select = groupReceiptSelectColumns();
    ({ data, error } = await supabaseClient.from("group_chat_reads").select(select).in("chat_id", chatIds));
  }

  if (error) {
    if (noteGroupChatReadsSupport(error)) return byChat;
    console.warn("Не удалось загрузить статусы участников групп:", error);
    return byChat;
  }

  groupChatReadsSupported = true;
  if (groupDeliveredAtSupported !== false && select.includes("last_delivered_at")) {
    groupDeliveredAtSupported = true;
  }

  for (const row of data || []) {
    const chatId = String(row.chat_id || "");
    const userId = String(row.user_id || "");
    if (!chatId || !userId) continue;
    let map = byChat.get(chatId);
    if (!map) {
      map = new Map();
      byChat.set(chatId, map);
    }
    map.set(userId, mapGroupReceiptRow(row));
  }
  return byChat;
}

async function loadActiveGroupReceipts(chatId) {
  activeGroupReceiptsByUser = new Map();
  if (!chatId || groupChatReadsSupported === false) return activeGroupReceiptsByUser;
  const byChat = await fetchGroupMemberReceiptsByChat([chatId]);
  activeGroupReceiptsByUser = byChat.get(String(chatId)) || new Map();
  return activeGroupReceiptsByUser;
}

function applyGroupOutgoingReceiptsToFeed() {
  const feed = document.getElementById("messagesFeed");
  const groupId = parseGroupId();
  if (!feed || !groupId || !isGroupChat()) return;
  const chat = groupChatsById.get(groupId);
  const memberIds = chat?.memberIds || [];
  const uid = getCurrentUserId();

  for (const el of feed.querySelectorAll('.message-item--out[data-message-id]')) {
    const id = el.getAttribute("data-message-id");
    const row = id ? feedMessagesById.get(String(id)) : null;
    if (!row) continue;
    const html = renderGroupParticipantReceiptsHtml(
      row.created_at,
      memberIds,
      activeGroupReceiptsByUser,
      row.sender_id || uid,
    );
    let slot = el.querySelector(".message-item-group-receipts");
    if (!html) {
      if (slot) slot.remove();
      continue;
    }
    if (slot) {
      slot.outerHTML = html;
    } else {
      const meta = el.querySelector(".message-item-meta");
      if (meta) {
        const edited = meta.querySelector(".message-item-edited");
        const time = meta.querySelector(".message-item-time");
        const tmp = document.createElement("div");
        tmp.innerHTML = html;
        const node = tmp.firstChild;
        if (node) {
          if (time) meta.insertBefore(node, time);
          else if (edited) meta.insertBefore(node, edited.nextSibling);
          else meta.appendChild(node);
        }
      }
    }
  }
}

async function syncGroupOutgoingReceipts() {
  if (!isGroupChat() || groupChatReadsSupported === false) return;
  const groupId = parseGroupId();
  if (!groupId) return;
  await loadActiveGroupReceipts(groupId);
  applyGroupOutgoingReceiptsToFeed();
}

async function acknowledgeGroupMessagesDelivered() {
  if (groupChatsSupported === false || groupChatReadsSupported === false) return;
  if (groupDeliveredAtSupported === false) return;

  const uid = getCurrentUserId();
  if (!uid) return;

  let chats = [...groupChatsById.values()];
  if (!chats.length) {
    const { chats: fetched, error } = await fetchMyGroupChats();
    if (error || !fetched?.length) return;
    chats = fetched;
  }
  if (!chats.length) return;

  const at = new Date().toISOString();
  const activeGroupId = isGroupChat() && messagesView === "dialog" ? parseGroupId() : null;

  await Promise.all(
    chats.map(async (chat) => {
      // Открытый групповой чат помечается через markGroupChatRead.
      if (activeGroupId && chat.id === activeGroupId) return;
      await markGroupChatDelivered(chat.id, at);
    }),
  );
}

function countUnreadGroupMessagesForChat(messages, uid, lastReadAt) {
  const me = String(uid);
  return (messages || []).filter((row) => {
    if (isMessageDeleted(row)) return false;
    if (String(row.sender_id) === me) return false;
    if (!lastReadAt) return true;
    return String(row.created_at || "") > String(lastReadAt);
  }).length;
}

function groupChatSelectColumns() {
  const base = "id, name, created_by, member_ids, created_at";
  if (groupAvatarSupported === false) return base;
  return `${base}, avatar_storage_path`;
}

function mapGroupChatRow(row) {
  return {
    id: String(row.id),
    name: String(row.name || "").trim() || "Групповой чат",
    created_by: row.created_by,
    memberIds: (row.member_ids || []).map(String),
    avatarStoragePath:
      groupAvatarSupported === false
        ? null
        : row.avatar_storage_path
          ? String(row.avatar_storage_path)
          : null,
    created_at: row.created_at,
  };
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

/** Текст сообщения для копирования в буфер обмена. */
function getMessageCopyText(row) {
  const stripped = stripRecipientMentionFromBody(row?.body, row?.recipient_email);
  return String(stripped || "")
    .replace(/\[\[order:(\d+)\]\]/g, (_, id) => `#${id}`)
    .trim();
}

async function copyTextToClipboard(text) {
  const value = String(text ?? "");
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

async function copyMessageText(row) {
  const text = getMessageCopyText(row);
  if (!text) return false;
  const ok = await copyTextToClipboard(text);
  if (!ok) {
    const msg = document.getElementById("messagesPageMessage");
    if (msg) msg.textContent = "Не удалось скопировать текст";
  }
  return ok;
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
  const knownW = Number(row.attachment_width);
  const knownH = Number(row.attachment_height);
  const hasKnownSize =
    Number.isFinite(knownW) && knownW > 0 && Number.isFinite(knownH) && knownH > 0;
  // Без размеров из БД сразу берём max-слот — после load размер НЕ меняем (иначе прыжки).
  const slot = chatPhotoSlotSize(hasKnownSize ? knownW : null, hasKnownSize ? knownH : null);
  const sizeStyle = chatPhotoSlotStyleAttr(hasKnownSize ? knownW : null, hasKnownSize ? knownH : null);
  const dimAttrs = hasKnownSize
    ? ` data-width="${Math.round(knownW)}" data-height="${Math.round(knownH)}"`
    : "";
  return `<div class="message-item-attachment" ${sizeStyle} data-storage-path="${escapeHtml(row.attachment_storage_path || "")}" data-thumb-path="${escapeHtml(row.attachment_thumbnail_path || "")}" data-mime-type="${mime}" data-file-name="${escapeHtml(fileName)}" data-file-size="${escapeHtml(size)}"${dimAttrs}>
      <div class="message-item-photo-loading" aria-hidden="true">Загрузка…</div>
      <a class="message-item-photo-link" href="#" target="_blank" rel="noopener noreferrer" title="Открыть полное изображение" hidden>
        <img class="message-item-photo" alt="${alt}" width="${slot.width}" height="${slot.height}" decoding="async" />
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
  const groupId = showPeer ? parseGroupId() : null;
  const groupChat = groupId ? groupChatsById.get(groupId) : null;
  const groupReceiptsHtml =
    isOut && showPeer && groupChat
      ? renderGroupParticipantReceiptsHtml(
          row.created_at,
          groupChat.memberIds,
          activeGroupReceiptsByUser,
          row.sender_id,
        )
      : "";
  const showDmTicks = isOut && !isGroupChat();
  const statusAttr = showDmTicks ? ` data-delivery-status="${state.status}"` : "";
  const editedLabel = row.edited_at ? `<span class="message-item-edited" title="Изменено">изм.</span>` : "";
  const timeHtml = `<time class="message-item-time">${escapeHtml(formatTaskDateRu(row.created_at))}</time>`;
  const metaTrailing = showDmTicks
    ? `${editedLabel}${renderOutgoingTicksHtml(state)}${timeHtml}`
    : showPeer && isOut
      ? `${editedLabel}${groupReceiptsHtml}${timeHtml}`
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
  if (!img) return Promise.resolve();
  if (img.complete && img.naturalWidth > 0) return Promise.resolve();
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
      // В пузыре (~240 CSS-px, на Retina до ~720 физ. px) старые thumb ~280px мылят «квадратами».
      // Показываем уже сжатый полный файл — объём в storage/БД не растёт; thumb остаётся для списков.
      let previewUrl = await getSignedFileUrl(storagePath);
      if (!previewUrl && thumbPath) {
        previewUrl = await getSignedFileUrl(thumbPath);
      }
      const fullUrl = previewUrl;
      const loading = el.querySelector(".message-item-photo-loading");
      const link = el.querySelector(".message-item-photo-link");
      const img = el.querySelector(".message-item-photo");
      if (!previewUrl || !link || !img) {
        if (loading) loading.textContent = "Фото недоступно";
        return;
      }

      // Слот уже зафиксирован при рендере — после load размер НЕ трогаем.
      img.src = previewUrl;
      link.href = fullUrl || previewUrl;
      link.hidden = false;
      await waitForImageSettle(img);
      if (loading) loading.remove();
      el.dataset.hydrated = "1";
    }),
  );
}

function getMessagesFastLoadSinceIso(days = MESSAGES_FAST_LOAD_DAYS) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - Math.max(0, days - 1));
  return d.toISOString();
}

async function fetchUserMessagesQuery(buildQuery) {
  let query = buildQuery(messageSelectColumns());
  let { data, error } = await query;

  if (error && noteMessageActionsSupport(error)) {
    query = buildQuery(messageSelectColumns());
    ({ data, error } = await query);
  }

  if (error && noteAttachmentDimensionSupport(error)) {
    query = buildQuery(messageSelectColumns());
    ({ data, error } = await query);
  }

  if (error && noteAttachmentSupport(error)) {
    query = buildQuery(messageSelectColumns());
    ({ data, error } = await query);
  }

  if (error && noteDeliveredAtSupport(error) && deliveredAtSupported === false) {
    query = buildQuery(messageSelectColumns());
    ({ data, error } = await query);
  } else if (!error) {
    deliveredAtSupported = deliveredAtSupported !== false;
    if (attachmentColumnsSupported !== false) attachmentColumnsSupported = true;
    if (attachmentDimensionColumnsSupported !== false && messageSelectColumns().includes("attachment_width")) {
      attachmentDimensionColumnsSupported = true;
    }
    if (messageActionsSupported !== false) messageActionsSupported = true;
  }

  return { rows: data || [], error };
}

/** Вся история DM пользователя — только для редких случаев; предпочтительнее scoped-запросы. */
async function fetchAllUserMessages() {
  const uid = getCurrentUserId();
  if (!uid) return { rows: [], error: null };

  const { data, error } = await fetchAllSupabaseRows(() =>
    supabaseClient
      .from("user_messages")
      .select(messageSelectColumns())
      .or(`sender_id.eq.${uid},recipient_id.eq.${uid}`)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  );
  return { rows: data || [], error };
}

/** Недавние DM для списка чатов (превью последнего сообщения). */
async function fetchRecentUserMessagesForChatList({ sinceIso = null, limit = CHAT_LIST_DM_PREVIEW_LIMIT } = {}) {
  const uid = getCurrentUserId();
  if (!uid) return { rows: [], error: null };

  const runQuery = (cols) => {
    let q = supabaseClient
      .from("user_messages")
      .select(cols)
      .or(`sender_id.eq.${uid},recipient_id.eq.${uid}`)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (sinceIso) q = q.gte("created_at", sinceIso);
    return q;
  };

  let cols = chatListPreviewSelectColumns();
  let { data, error } = await runQuery(cols);

  if (error && noteMessageActionsSupport(error)) {
    cols = chatListPreviewSelectColumns();
    ({ data, error } = await runQuery(cols));
  }

  if (error && noteAttachmentSupport(error)) {
    cols = chatListPreviewSelectColumns();
    ({ data, error } = await runQuery(cols));
  }

  if (error && noteDeliveredAtSupport(error) && deliveredAtSupported === false) {
    cols = chatListPreviewSelectColumns();
    ({ data, error } = await runQuery(cols));
  } else if (!error) {
    deliveredAtSupported = deliveredAtSupported !== false;
    if (attachmentColumnsSupported !== false) attachmentColumnsSupported = true;
    if (messageActionsSupported !== false) messageActionsSupported = true;
  }

  if (error) return { rows: [], error };
  // buildChatListEntries ожидает хронологию; reverse дешёвый на ≤800 строк.
  return { rows: (data || []).slice().reverse(), error: null };
}

/** Только непрочитанные входящие — точный unread без полной истории. */
async function fetchUnreadIncomingDmMeta() {
  const uid = getCurrentUserId();
  if (!uid) return { rows: [], error: null };

  let select = "sender_id, sender_email";
  if (messageActionsSupported !== false) select += ", deleted_at";

  const buildQuery = () => {
    let query = supabaseClient
      .from("user_messages")
      .select(select)
      .eq("recipient_id", uid)
      .is("read_at", null)
      .order("id", { ascending: true });
    if (messageActionsSupported !== false) {
      query = query.is("deleted_at", null);
    }
    return query;
  };

  let { data, error } = await fetchAllSupabaseRows(buildQuery);
  if (error && noteMessageActionsSupport(error)) {
    select = "sender_id, sender_email";
    ({ data, error } = await fetchAllSupabaseRows(() =>
      supabaseClient
        .from("user_messages")
        .select(select)
        .eq("recipient_id", uid)
        .is("read_at", null)
        .order("id", { ascending: true }),
    ));
  }
  if (error) return { rows: [], error };
  return { rows: data || [], error: null };
}

/** Сообщения одного peer (1:1), без выгрузки всей переписки пользователя. */
async function fetchPeerMessages(peerId, { sinceIso = null, limit = DIALOG_MESSAGE_LIMIT } = {}) {
  const uid = getCurrentUserId();
  if (!uid || !peerId) return { rows: [], error: null };

  const filter = `and(sender_id.eq.${uid},recipient_id.eq.${peerId}),and(sender_id.eq.${peerId},recipient_id.eq.${uid})`;
  const { rows, error } = await fetchUserMessagesQuery((cols) => {
    let q = supabaseClient
      .from("user_messages")
      .select(cols)
      .or(filter)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (sinceIso) q = q.gte("created_at", sinceIso);
    return q;
  });
  if (error) return { rows, error };
  return { rows: rows.slice().reverse(), error: null };
}

async function fetchMyGroupChats() {
  if (groupChatsSupported === false) return { chats: [], error: null };

  const uid = getCurrentUserId();
  if (!uid) return { chats: [], error: null };

  let select = groupChatSelectColumns();
  let { data, error } = await supabaseClient
    .from("group_chats")
    .select(select)
    .contains("member_ids", [uid])
    .order("created_at", { ascending: false });

  if (error && noteGroupAvatarSupport(error)) {
    select = groupChatSelectColumns();
    ({ data, error } = await supabaseClient
      .from("group_chats")
      .select(select)
      .contains("member_ids", [uid])
      .order("created_at", { ascending: false }));
  }

  if (error) {
    if (noteGroupChatsSupport(error)) return { chats: [], error: null };
    return { chats: [], error };
  }

  groupChatsSupported = true;
  if (groupAvatarSupported !== false && select.includes("avatar_storage_path")) {
    groupAvatarSupported = true;
  }
  const chats = (data || []).map(mapGroupChatRow);

  groupChatsById = new Map(chats.map((chat) => [chat.id, chat]));
  return { chats, error: null };
}

async function fetchGroupMessages(chatId, { sinceIso = null, limit = DIALOG_MESSAGE_LIMIT } = {}) {
  if (!chatId || groupChatsSupported === false) return { rows: [], error: null };

  const selectBase = "id, chat_id, sender_id, sender_email, body, created_at";
  let select = withMessageActionColumns(withAttachmentColumns(selectBase));

  async function run(sel) {
    let q = supabaseClient
      .from("group_messages")
      .select(sel)
      .eq("chat_id", chatId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (sinceIso) q = q.gte("created_at", sinceIso);
    return q;
  }

  let { data, error } = await run(select);

  if (error && noteMessageActionsSupport(error)) {
    select = withMessageActionColumns(withAttachmentColumns(selectBase));
    ({ data, error } = await run(select));
  }

  if (error && noteAttachmentDimensionSupport(error)) {
    select = withMessageActionColumns(withAttachmentColumns(selectBase));
    ({ data, error } = await run(select));
  }

  if (error && noteAttachmentSupport(error)) {
    select = withMessageActionColumns(withAttachmentColumns(selectBase));
    ({ data, error } = await run(select));
  }

  if (error) {
    if (noteGroupChatsSupport(error)) return { rows: [], error: null };
    return { rows: [], error };
  }

  groupChatsSupported = true;
  if (attachmentColumnsSupported !== false) attachmentColumnsSupported = true;
  if (messageActionsSupported !== false) messageActionsSupported = true;
  return { rows: (data || []).slice().reverse(), error: null };
}

/** Последнее сообщение по каждому чату — один batch-запрос вместо N+1. */
async function fetchLastGroupMessagesByChat(chatIds) {
  if (!chatIds?.length || groupChatsSupported === false) {
    return { lastByChat: new Map() };
  }

  const selectBase = "id, chat_id, sender_id, sender_email, body, created_at";
  let select =
    messageActionsSupported !== false
      ? `${selectBase}, deleted_at, attachment_storage_path`
      : `${selectBase}, attachment_storage_path`;
  const limit = Math.min(Math.max(chatIds.length * 4, 40), 400);

  async function run(sel) {
    return supabaseClient
      .from("group_messages")
      .select(sel)
      .in("chat_id", chatIds)
      .order("created_at", { ascending: false })
      .limit(limit);
  }

  let { data, error } = await run(select);

  if (error && noteMessageActionsSupport(error)) {
    select = `${selectBase}, attachment_storage_path`;
    ({ data, error } = await run(select));
  }

  if (error && noteAttachmentSupport(error)) {
    select = selectBase;
    if (messageActionsSupported !== false) select += ", deleted_at";
    ({ data, error } = await run(select));
  }

  if (error) {
    if (noteGroupChatsSupport(error)) return { lastByChat: new Map() };
    console.warn("Ошибка загрузки последних сообщений групп:", error);
    return { lastByChat: new Map() };
  }

  groupChatsSupported = true;
  if (attachmentColumnsSupported !== false) attachmentColumnsSupported = true;
  if (messageActionsSupported !== false) messageActionsSupported = true;

  const lastByChat = new Map();
  for (const row of data || []) {
    const chatId = String(row.chat_id);
    if (lastByChat.has(chatId)) continue;
    if (isMessageDeleted(row)) continue;
    lastByChat.set(chatId, row);
  }

  return { lastByChat };
}

/** Точный unread групп — один batch-запрос вместо N count-запросов. */
async function fetchGroupUnreadCounts(chatIds, uid, lastReadByChat) {
  const unreadByChat = new Map();
  if (!chatIds?.length || groupChatsSupported === false || !uid) return unreadByChat;

  for (const chatId of chatIds) {
    unreadByChat.set(String(chatId), 0);
  }

  let select = "id, chat_id, created_at, sender_id";
  if (messageActionsSupported !== false) select += ", deleted_at";

  let query = supabaseClient
    .from("group_messages")
    .select(select)
    .in("chat_id", chatIds)
    .neq("sender_id", uid);

  let minLastRead = null;
  for (const chatId of chatIds) {
    const lastRead = lastReadByChat?.get(String(chatId)) || lastReadByChat?.get(chatId);
    if (lastRead && (!minLastRead || lastRead < minLastRead)) {
      minLastRead = lastRead;
    }
  }
  if (minLastRead) {
    query = query.gt("created_at", minLastRead);
  }

  let { data, error } = await query;

  if (error && noteMessageActionsSupport(error)) {
    select = "id, chat_id, created_at, sender_id";
    query = supabaseClient
      .from("group_messages")
      .select(select)
      .in("chat_id", chatIds)
      .neq("sender_id", uid);
    if (minLastRead) query = query.gt("created_at", minLastRead);
    ({ data, error } = await query);
  }

  if (error) {
    if (!noteGroupChatsSupport(error)) {
      console.warn("Ошибка подсчёта непрочитанных группы:", error);
    }
    return unreadByChat;
  }

  for (const row of data || []) {
    if (isMessageDeleted(row)) continue;
    const chatId = String(row.chat_id);
    const lastRead = lastReadByChat?.get(chatId);
    if (lastRead && row.created_at <= lastRead) continue;
    unreadByChat.set(chatId, (unreadByChat.get(chatId) || 0) + 1);
  }

  return unreadByChat;
}

function buildPeerInfoMap(rows, unreadRows, uid) {
  const map = new Map();
  for (const row of rows || []) {
    const peerId = peerIdFromMessage(row, uid);
    if (!peerId || map.has(peerId)) continue;
    const isOut = String(row.sender_id) === String(uid);
    const email = (isOut ? row.recipient_email : row.sender_email) || "";
    map.set(peerId, { id: peerId, email });
  }
  for (const row of unreadRows || []) {
    const peerId = String(row.sender_id || "");
    if (!peerId || map.has(peerId)) continue;
    map.set(peerId, { id: peerId, email: row.sender_email || "" });
  }
  return map;
}

function buildChatListEntries(peerInfo, rows, groupChats, lastGroupMessages, groupUnreadByChat, dmUnreadByPeer) {
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

  const activePeerIds = new Set([...byPeer.keys(), ...(dmUnreadByPeer ? dmUnreadByPeer.keys() : [])]);
  const userEntries = [];
  for (const peerKey of activePeerIds) {
    const info = peerInfo.get(peerKey);
    const bucket = byPeer.get(peerKey);
    const last = bucket?.last || null;
    const unreadCount = dmUnreadByPeer
      ? dmUnreadByPeer.get(peerKey) || 0
      : (bucket?.messages || []).filter((m) => String(m.recipient_id) === String(uid) && !m.read_at)
          .length;
    let email = info?.email || "";
    if (!email && last) {
      const isOut = String(last.sender_id) === String(uid);
      email = (isOut ? last.recipient_email : last.sender_email) || "";
    }
    const name = displayNameByEmail(email) || email || "—";
    userEntries.push({
      peerId: peerKey,
      kind: "user",
      name,
      email,
      unreadCount,
      last,
      sortAt: last?.created_at || "",
    });
  }

  const groupEntries = (groupChats || []).map((chat) => {
    const unreadCount = groupUnreadByChat?.get(chat.id) || 0;
    const last = lastGroupMessages?.get(chat.id) || null;
    return {
      peerId: toGroupPeerId(chat.id),
      kind: "group",
      name: chat.name,
      email: "",
      avatarStoragePath: chat.avatarStoragePath || null,
      memberIds: chat.memberIds || [],
      unreadCount,
      last: last
        ? {
            ...last,
            recipient_id: null,
            recipient_email: "",
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

function renderChatListTicks(last, uid, entry = null, receiptsByUser = null) {
  if (!last) return "";
  const isOut = String(last.sender_id) === String(uid);
  if (!isOut) return "";

  if (entry?.kind === "group" || (last.recipient_id == null && last.chat_id)) {
    const memberIds = entry?.memberIds || groupChatsById.get(String(last.chat_id))?.memberIds || [];
    const status = aggregateGroupOutgoingListStatus(
      last.created_at,
      memberIds,
      receiptsByUser,
      last.sender_id,
    );
    if (status === "read") {
      return renderOutgoingTicksHtml({ read: true, delivered: true, status: "read" });
    }
    if (status === "delivered") {
      // В списке: доставлено всем — одна галочка (как «sent» у DM).
      return renderOutgoingTicksHtml({ read: false, delivered: true, status: "sent" });
    }
    return "";
  }

  const state = messageDeliveryState(last, true);
  // В списке чатов: прочитано — две синие, доставлено/отправлено — одна.
  if (state.read) {
    return renderOutgoingTicksHtml({ ...state, status: "read" });
  }
  return renderOutgoingTicksHtml({ ...state, status: "sent" });
}

function getChatAvatarKey(entry) {
  if (entry.kind !== "group") {
    const logoUrl = avatarLogoUrl({ email: entry.email, name: entry.name });
    if (logoUrl) return `logo:${logoUrl}`;
  }
  if (entry.kind === "group" && entry.avatarStoragePath) {
    return `group:${entry.avatarStoragePath}`;
  }
  return `initial:${entry.peerId}`;
}

function preloadImageUrl(url, readySet = staticAvatarImageReady) {
  if (!url || readySet.has(url)) return Promise.resolve();
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = img.onerror = () => {
      readySet.add(url);
      resolve();
    };
    img.src = url;
  });
}

function getCachedGroupAvatarUrl(storagePath) {
  const key = String(storagePath || "");
  if (!key) return null;
  const entry = groupAvatarUrlCache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    groupAvatarUrlCache.delete(key);
    return null;
  }
  return entry.url;
}

function setCachedGroupAvatarUrl(storagePath, url) {
  const key = String(storagePath || "");
  if (!key || !url) return;
  groupAvatarUrlCache.set(key, { url, expiresAt: Date.now() + GROUP_AVATAR_URL_CACHE_MS });
}

function invalidateGroupAvatarUrlCache(storagePath) {
  const key = String(storagePath || "");
  if (!key) return;
  const cachedUrl = getCachedGroupAvatarUrl(key);
  if (cachedUrl) groupAvatarImageReady.delete(cachedUrl);
  groupAvatarUrlCache.delete(key);
}

async function resolveGroupAvatarUrl(storagePath) {
  const cached = getCachedGroupAvatarUrl(storagePath);
  if (cached) return cached;
  const url = await getSignedFileUrl(storagePath);
  if (url) setCachedGroupAvatarUrl(storagePath, url);
  return url;
}

async function preloadGroupAvatarUrls(groupChats) {
  const paths = [
    ...new Set(
      (groupChats || [])
        .map((chat) => chat.avatarStoragePath)
        .filter(Boolean)
        .map(String),
    ),
  ];
  const missing = paths.filter((path) => !getCachedGroupAvatarUrl(path));
  if (missing.length) {
    await Promise.all(missing.map((path) => resolveGroupAvatarUrl(path)));
  }
  const urls = paths.map((path) => getCachedGroupAvatarUrl(path)).filter(Boolean);
  await Promise.all(urls.map((url) => preloadImageUrl(url, groupAvatarImageReady)));
}

async function preloadChatListAvatarsForEntries(entries) {
  const groupChats = (entries || [])
    .filter((entry) => entry.kind === "group" && entry.avatarStoragePath)
    .map((entry) => ({ avatarStoragePath: entry.avatarStoragePath }));
  const staticUrls = new Set();
  for (const entry of entries || []) {
    if (entry.kind !== "user") continue;
    const logoUrl = avatarLogoUrl({ email: entry.email, name: entry.name });
    if (logoUrl) staticUrls.add(logoUrl);
  }
  await Promise.all([
    preloadGroupAvatarUrls(groupChats),
    ...[...staticUrls].map((url) => preloadImageUrl(url, staticAvatarImageReady)),
  ]);
}

function renderGroupAvatarHtml(groupAvatarPath, avatarKey) {
  const cachedUrl = getCachedGroupAvatarUrl(groupAvatarPath);
  if (cachedUrl) {
    return `<span class="messages-chat-avatar messages-chat-avatar--logo" data-avatar-path="${escapeHtml(groupAvatarPath)}" data-avatar-hydrated="1" data-avatar-key="${escapeHtml(avatarKey)}" aria-hidden="true"><img src="${escapeHtml(cachedUrl)}" alt="" width="48" height="48" decoding="sync"></span>`;
  }
  return `<span class="messages-chat-avatar messages-chat-avatar--loading" data-avatar-path="${escapeHtml(groupAvatarPath)}" data-avatar-key="${escapeHtml(avatarKey)}" aria-hidden="true"></span>`;
}

function renderChatListItem(entry, groupReceiptsByChat = null) {
  const uid = getCurrentUserId();
  const last = entry.last;
  const preview = last
    ? previewMessageBody(last.body, last.recipient_email, last)
    : "Нет сообщений";
  const time = last ? formatChatListTime(last.created_at) : "";
  const chatId = entry.kind === "group" ? parseGroupId(entry.peerId) : null;
  const receiptsByUser =
    entry.kind === "group" && chatId && groupReceiptsByChat
      ? groupReceiptsByChat.get(String(chatId)) || new Map()
      : null;
  const ticks = renderChatListTicks(last, uid, entry, receiptsByUser);
  const unreadCount = entry.unreadCount || 0;
  const countLabel = unreadCount > 0 ? (unreadCount > 99 ? "99+" : String(unreadCount)) : "";
  const hue = avatarHue(entry.kind === "group" ? entry.peerId : entry.email || entry.peerId);
  const initial = avatarInitial(entry.name);
  const logoUrl =
    entry.kind === "group" ? null : avatarLogoUrl({ email: entry.email, name: entry.name });
  const groupAvatarPath =
    entry.kind === "group" && entry.avatarStoragePath ? String(entry.avatarStoragePath) : "";
  const avatarKey = getChatAvatarKey(entry);
  const unread = unreadCount > 0;
  let avatarHtml;
  if (logoUrl) {
    avatarHtml = `<span class="messages-chat-avatar messages-chat-avatar--logo" data-avatar-key="${escapeHtml(avatarKey)}" aria-hidden="true"><img src="${escapeHtml(logoUrl)}" alt="" width="48" height="48" decoding="sync"></span>`;
  } else if (groupAvatarPath) {
    avatarHtml = renderGroupAvatarHtml(groupAvatarPath, avatarKey);
  } else {
    avatarHtml = `<span class="messages-chat-avatar" style="--messages-avatar-hue: ${hue}" data-avatar-key="${escapeHtml(avatarKey)}" aria-hidden="true">${escapeHtml(initial)}</span>`;
  }

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

function buildChatListSignature(entries) {
  return entries
    .map((entry) => {
      const last = entry.last;
      const preview = last ? previewMessageBody(last.body, last.recipient_email, last) : "";
      return `${entry.peerId}|${entry.sortAt}|${entry.unreadCount}|${entry.name}|${preview}`;
    })
    .join("\n");
}

function createChatListItemElement(entry, groupReceiptsByChat) {
  const tpl = document.createElement("template");
  tpl.innerHTML = renderChatListItem(entry, groupReceiptsByChat).trim();
  return tpl.content.firstElementChild;
}

function updateChatListItemTicks(timeWrap, ticksHtml) {
  if (!timeWrap) return;
  const timeEl = timeWrap.querySelector(".messages-chat-item-time");
  if (!timeEl) return;
  for (const child of [...timeWrap.children]) {
    if (child !== timeEl) child.remove();
  }
  if (ticksHtml) {
    timeEl.insertAdjacentHTML("beforebegin", ticksHtml);
  }
}

function updateChatListItemUnreadBadge(bottomEl, countLabel) {
  if (!bottomEl) return;
  let countEl = bottomEl.querySelector(".messages-chat-item-count");
  if (countLabel) {
    if (!countEl) {
      countEl = document.createElement("span");
      countEl.className = "messages-chat-item-count";
      countEl.title = "Непрочитанных сообщений";
      bottomEl.appendChild(countEl);
    }
    countEl.textContent = countLabel;
  } else if (countEl) {
    countEl.remove();
  }
}

function replaceChatListItemAvatar(button, entry) {
  const avatarKey = getChatAvatarKey(entry);
  const avatarEl = button.querySelector(".messages-chat-avatar");
  if (avatarEl && avatarEl.getAttribute("data-avatar-key") === avatarKey) return;

  const hue = avatarHue(entry.kind === "group" ? entry.peerId : entry.email || entry.peerId);
  const initial = avatarInitial(entry.name);
  const logoUrl =
    entry.kind === "group" ? null : avatarLogoUrl({ email: entry.email, name: entry.name });
  const groupAvatarPath =
    entry.kind === "group" && entry.avatarStoragePath ? String(entry.avatarStoragePath) : "";

  let avatarHtml;
  if (logoUrl) {
    avatarHtml = `<span class="messages-chat-avatar messages-chat-avatar--logo" data-avatar-key="${escapeHtml(avatarKey)}" aria-hidden="true"><img src="${escapeHtml(logoUrl)}" alt="" width="48" height="48" decoding="sync"></span>`;
  } else if (groupAvatarPath) {
    avatarHtml = renderGroupAvatarHtml(groupAvatarPath, avatarKey);
  } else {
    avatarHtml = `<span class="messages-chat-avatar" style="--messages-avatar-hue: ${hue}" data-avatar-key="${escapeHtml(avatarKey)}" aria-hidden="true">${escapeHtml(initial)}</span>`;
  }

  if (avatarEl) {
    avatarEl.outerHTML = avatarHtml;
  } else {
    button.insertAdjacentHTML("afterbegin", avatarHtml);
  }
}

function updateChatListItemEl(button, entry, groupReceiptsByChat) {
  const uid = getCurrentUserId();
  const last = entry.last;
  const preview = last
    ? previewMessageBody(last.body, last.recipient_email, last)
    : "Нет сообщений";
  const time = last ? formatChatListTime(last.created_at) : "";
  const chatId = entry.kind === "group" ? parseGroupId(entry.peerId) : null;
  const receiptsByUser =
    entry.kind === "group" && chatId && groupReceiptsByChat
      ? groupReceiptsByChat.get(String(chatId)) || new Map()
      : null;
  const ticks = renderChatListTicks(last, uid, entry, receiptsByUser);
  const unreadCount = entry.unreadCount || 0;
  const countLabel = unreadCount > 0 ? (unreadCount > 99 ? "99+" : String(unreadCount)) : "";

  button.classList.toggle("messages-chat-item--unread", unreadCount > 0);
  button.classList.toggle("messages-chat-item--group", entry.kind === "group");

  const nameEl = button.querySelector(".messages-chat-item-name");
  if (nameEl) nameEl.textContent = entry.name;

  const timeEl = button.querySelector(".messages-chat-item-time");
  if (timeEl) timeEl.textContent = time;

  updateChatListItemTicks(button.querySelector(".messages-chat-item-time-wrap"), ticks);

  const previewEl = button.querySelector(".messages-chat-item-preview");
  if (previewEl) previewEl.textContent = preview || " ";

  updateChatListItemUnreadBadge(button.querySelector(".messages-chat-item-bottom"), countLabel);

  replaceChatListItemAvatar(button, entry);
}

function syncChatListDom(list, entries, groupReceiptsByChat) {
  const existingByPeer = new Map();
  for (const el of list.querySelectorAll(".messages-chat-item[data-peer-id]")) {
    existingByPeer.set(el.getAttribute("data-peer-id") || "", el);
  }

  const seen = new Set();
  for (const entry of entries) {
    seen.add(entry.peerId);
    let el = existingByPeer.get(entry.peerId);
    if (el) {
      updateChatListItemEl(el, entry, groupReceiptsByChat);
    } else {
      el = createChatListItemElement(entry, groupReceiptsByChat);
    }
    list.appendChild(el);
  }

  for (const [peerId, el] of existingByPeer) {
    if (!seen.has(peerId)) el.remove();
  }
}

async function hydrateGroupAvatars(root = document) {
  const nodes = [
    ...root.querySelectorAll(".messages-chat-avatar[data-avatar-path]:not([data-avatar-hydrated])"),
  ];
  if (!nodes.length) return;
  await Promise.all(
    nodes.map(async (el) => {
      const storagePath = el.getAttribute("data-avatar-path") || "";
      if (!storagePath) return;
      try {
        const url = await resolveGroupAvatarUrl(storagePath);
        if (!url || !el.isConnected) return;
        await preloadImageUrl(url, groupAvatarImageReady);
        if (!el.isConnected) return;
        el.classList.remove("messages-chat-avatar--loading");
        el.classList.add("messages-chat-avatar--logo");
        el.removeAttribute("style");
        el.textContent = "";
        const img = document.createElement("img");
        img.src = url;
        img.alt = "";
        img.width = 48;
        img.height = 48;
        img.decoding = "sync";
        el.appendChild(img);
        // data-avatar-path оставляем: по нему снимок списка чатов сбрасывает
        // просроченный подписанный URL обратно в заглушку.
        el.dataset.avatarHydrated = "1";
      } catch (err) {
        console.warn("Не удалось загрузить аватар группы:", err);
      }
    }),
  );
}

let loadChatListGeneration = 0;
let loadMessagesGeneration = 0;

function whenIdle(timeout = 1500) {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => resolve(), { timeout });
      return;
    }
    setTimeout(resolve, 1);
  });
}

/**
 * Пакет запросов от js/chat-boot.js: они ушли в сеть ещё во время разбора HTML,
 * до supabase-js и графа main.js. Забираем один раз, дальше — обычные запросы.
 */
function takeChatBootPack() {
  const boot = window.__chatBoot;
  if (!boot) return null;
  delete window.__chatBoot;
  if (String(boot.uid) !== String(getCurrentUserId())) return null;
  return boot;
}

/** chat-boot.js просит полный набор колонок: успешный ответ = все опциональные поля есть. */
function noteFullMessageSchemaSupported() {
  if (deliveredAtSupported !== false) deliveredAtSupported = true;
  if (messageActionsSupported !== false) messageActionsSupported = true;
  if (attachmentColumnsSupported !== false) attachmentColumnsSupported = true;
}

function adoptBootDmRows(pack, sinceIso) {
  if (!pack?.rows) {
    return fetchRecentUserMessagesForChatList({ sinceIso, limit: CHAT_LIST_FAST_PREVIEW_LIMIT });
  }
  noteFullMessageSchemaSupported();
  return { rows: pack.rows, error: null };
}

function adoptBootUnreadRows(pack) {
  if (!pack?.rows) return fetchUnreadIncomingDmMeta();
  noteFullMessageSchemaSupported();
  return { rows: pack.rows, error: null };
}

function adoptBootGroupChats(pack) {
  if (!pack?.rows) return fetchMyGroupChats();
  groupChatsSupported = true;
  groupAvatarSupported = true;
  const chats = pack.rows.map(mapGroupChatRow);
  groupChatsById = new Map(chats.map((chat) => [chat.id, chat]));
  return { chats, error: null };
}

/**
 * Снимок для мгновенной отрисовки на следующем холодном старте (см. js/chat-boot.js).
 * Подписанные URL аватаров групп живут минуты, поэтому сохраняем их заглушкой —
 * hydrateGroupAvatars подставит свежие.
 */
function saveChatListSnapshot(list) {
  const uid = getCurrentUserId();
  if (!uid) return;

  const items = [...list.querySelectorAll(".messages-chat-item[data-peer-id]")].slice(
    0,
    CHAT_LIST_SNAPSHOT_MAX_ITEMS,
  );
  if (!items.length) return;

  const html = items
    .map((item) => {
      const clone = item.cloneNode(true);
      for (const avatar of clone.querySelectorAll(".messages-chat-avatar[data-avatar-path]")) {
        avatar.textContent = "";
        avatar.removeAttribute("data-avatar-hydrated");
        avatar.classList.remove("messages-chat-avatar--logo");
        avatar.classList.add("messages-chat-avatar--loading");
      }
      return clone.outerHTML;
    })
    .join("");

  try {
    localStorage.setItem(CHAT_LIST_SNAPSHOT_KEY, JSON.stringify({ uid, html }));
  } catch {
    /* переполнение квоты — снимок не обязателен */
  }
}

function buildDmUnreadByPeer(unreadRows) {
  const dmUnreadByPeer = new Map();
  for (const row of unreadRows || []) {
    if (isMessageDeleted(row)) continue;
    const peerId = String(row.sender_id || "");
    if (!peerId) continue;
    dmUnreadByPeer.set(peerId, (dmUnreadByPeer.get(peerId) || 0) + 1);
  }
  return dmUnreadByPeer;
}

async function paintChatListFromData(list, rows, unreadRows, groupChats) {
  const uid = getCurrentUserId();
  const dmUnreadByPeer = buildDmUnreadByPeer(unreadRows);
  const peerInfo = buildPeerInfoMap(rows, unreadRows, uid);
  const chatIds = (groupChats || []).map((chat) => chat.id);
  const [{ lastByChat: lastGroupMessages }, groupReceiptsByChat] = await Promise.all([
    fetchLastGroupMessagesByChat(chatIds),
    fetchGroupMemberReceiptsByChat(chatIds),
  ]);
  // Своя прочитанность — часть уже полученных статусов участников, отдельный запрос не нужен.
  const lastReadByChat = ownReadsFromGroupReceipts(groupReceiptsByChat, uid);
  const groupUnreadByChat = await fetchGroupUnreadCounts(chatIds, uid, lastReadByChat);

  const entries = buildChatListEntries(
    peerInfo,
    rows,
    groupChats,
    lastGroupMessages,
    groupUnreadByChat,
    dmUnreadByPeer,
  );
  const signature = buildChatListSignature(entries);
  if (list.dataset.chatListSig === signature) return;
  list.dataset.chatListSig = signature;
  // Снимок мог быть отрисован прошлой версией renderChatListItem — не достраиваем
  // поверх него, а заменяем целиком; дальше syncChatListDom работает как обычно.
  if (list.dataset.chatListFromSnapshot === "1") {
    list.innerHTML = "";
    delete list.dataset.chatListFromSnapshot;
  }
  syncChatListDom(list, entries, groupReceiptsByChat);
  void hydrateGroupAvatars(list);
  void preloadChatListAvatarsForEntries(entries);
  document.dispatchEvent(new CustomEvent("chat-list-painted"));
  saveChatListSnapshot(list);
}

export async function loadChatList() {
  const list = document.getElementById("messagesChatList");
  const msg = document.getElementById("messagesChatListMessage");
  if (!list) return;

  const uid = getCurrentUserId();
  if (!uid) return;

  const gen = ++loadChatListGeneration;
  const sinceIso = getMessagesFastLoadSinceIso();

  if (msg) {
    msg.textContent = "";
    msg.classList.remove("messages-page-message--error");
  }

  const boot = takeChatBootPack();
  const [recentPack, unreadPack, groupPack] = await Promise.all([
    boot
      ? boot.dm.then((pack) => adoptBootDmRows(pack, sinceIso))
      : fetchRecentUserMessagesForChatList({ sinceIso, limit: CHAT_LIST_FAST_PREVIEW_LIMIT }),
    boot ? boot.unread.then(adoptBootUnreadRows) : fetchUnreadIncomingDmMeta(),
    boot ? boot.groups.then(adoptBootGroupChats) : fetchMyGroupChats(),
  ]);

  if (gen !== loadChatListGeneration) return;

  if (recentPack.error) {
    console.error("Ошибка загрузки сообщений:", recentPack.error);
    if (msg) {
      msg.textContent = "Ошибка загрузки сообщений. Проверьте, что таблица user_messages создана в Supabase.";
      msg.classList.add("messages-page-message--error");
    }
    list.innerHTML = "";
    list.removeAttribute("data-chat-list-sig");
    return;
  }

  if (groupPack.error) {
    console.warn("Ошибка загрузки групповых чатов:", groupPack.error);
  }

  await paintChatListFromData(
    list,
    recentPack.rows,
    unreadPack.rows,
    groupPack.chats || [],
  );

  // Второй проход добирает переписки старше MESSAGES_FAST_LOAD_DAYS. Он не влияет на
  // первый экран, поэтому ждём простоя: иначе 800 строк конкурируют с отрисовкой.
  void (async () => {
    await whenIdle();
    if (gen !== loadChatListGeneration || messagesView !== "list") return;
    const fuller = await fetchRecentUserMessagesForChatList({
      sinceIso: null,
      limit: CHAT_LIST_DM_PREVIEW_LIMIT,
    });
    if (gen !== loadChatListGeneration) return;
    if (fuller.error || messagesView !== "list") return;
    await paintChatListFromData(
      list,
      fuller.rows,
      unreadPack.rows,
      groupPack.chats || [],
    );
  })();

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
  const editBtn = document.getElementById("messagesEditGroupBtn");
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
    if (editBtn) editBtn.hidden = false;
    return;
  }

  if (editBtn) editBtn.hidden = true;

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

  const gen = ++loadMessagesGeneration;
  const peerAtStart = activePeerId;
  const sinceIso = getMessagesFastLoadSinceIso();

  if (msg) {
    msg.textContent = "";
    msg.classList.remove("messages-page-message--error");
  }

  async function fetchDialogRows({ since = null, limit = DIALOG_MESSAGE_LIMIT } = {}) {
    if (isGroupChat()) {
      return fetchGroupMessages(parseGroupId(), { sinceIso: since, limit });
    }
    return fetchPeerMessages(activePeerId, { sinceIso: since, limit });
  }

  async function renderDialogRows(rows, { markRead = true } = {}) {
    if (gen !== loadMessagesGeneration || activePeerId !== peerAtStart || messagesView !== "dialog") {
      return;
    }

    lastFeedMessageAt = rows.length ? rows[rows.length - 1].created_at : null;
    updateLastMessagePeerId(isGroupChat() ? [] : rows.filter((r) => !isMessageDeleted(r)));

    clearFeedMessageCache();
    rememberFeedMessages(rows);

    if (isGroupChat()) {
      const groupId = parseGroupId();
      if (groupId) await loadActiveGroupReceipts(groupId);
    }

    const visibleRows = rows.filter((row) => !isMessageDeleted(row));
    const emptyText = isGroupChat()
      ? "Пока нет сообщений в этом групповом чате. Напишите первое."
      : "Пока нет сообщений в этой переписке. Напишите первое.";

    const stickBottom = isFeedAtBottom(feed, 80) || !feed.querySelector("[data-message-id]");
    feed.innerHTML = visibleRows.length
      ? visibleRows.map(renderMessageItem).join("")
      : `<p class="messages-empty">${emptyText}</p>`;

    if (stickBottom) scrollMessagesFeedToBottom(feed);
    // Слоты фото фиксированы при рендере — повторный scroll после load не нужен (он давал мигание).
    await hydrateMessageAttachments(feed);

    if (!markRead) return;
    if (!isGroupChat()) {
      await markIncomingMessagesRead(visibleRows);
    } else {
      const groupId = parseGroupId();
      const latestAt =
        visibleRows.length > 0
          ? visibleRows[visibleRows.length - 1].created_at
          : new Date().toISOString();
      if (groupId) await markGroupChatRead(groupId, latestAt || new Date().toISOString());
    }
    void refreshMessagesUnreadBadge();
  }

  // Фаза 1: только последние 3 дня.
  const fast = await fetchDialogRows({ since: sinceIso });
  if (gen !== loadMessagesGeneration || activePeerId !== peerAtStart) return;

  if (fast.error) {
    console.error("Ошибка загрузки сообщений:", fast.error);
    if (msg) {
      msg.textContent = isGroupChat()
        ? "Ошибка загрузки сообщений группового чата."
        : "Ошибка загрузки сообщений. Проверьте, что таблица user_messages создана в Supabase.";
      msg.classList.add("messages-page-message--error");
    }
    feed.innerHTML = "";
    return;
  }

  await renderDialogRows(fast.rows, { markRead: true });

  // Фаза 2: догрузка более старых сообщений — только prepend, без полной перерисовки ленты.
  void (async () => {
    const fuller = await fetchDialogRows({ since: null, limit: DIALOG_MESSAGE_LIMIT });
    if (gen !== loadMessagesGeneration || activePeerId !== peerAtStart || messagesView !== "dialog") {
      return;
    }
    if (fuller.error) return;
    if (fuller.rows.length <= fast.rows.length) return;
    rememberFeedMessages(fuller.rows);
    prependOlderMessagesToFeed(fuller.rows);
  })();
}

export function onMessagesSectionEnter() {
  initMessagesSection();
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

/**
 * Вставляет более старые сообщения сверху, сохраняя визуальную позицию ленты.
 * Нельзя заново делать innerHTML всего диалога — иначе фото перезагружаются и лента мигает.
 */
function prependOlderMessagesToFeed(rows) {
  const feed = document.getElementById("messagesFeed");
  if (!feed || !rows?.length) return;

  const existingIds = getFeedMessageIds();
  const olderRows = rows.filter(
    (row) => !isMessageDeleted(row) && !existingIds.has(String(row.id)),
  );
  if (!olderRows.length) return;

  // rows приходят ascending (старые → новые); для prepend нужен тот же порядок.
  const html = olderRows.map(renderMessageItem).join("");
  if (!html) return;

  const prevHeight = feed.scrollHeight;
  const prevTop = feed.scrollTop;
  feed.insertAdjacentHTML("afterbegin", html);
  feed.scrollTop = prevTop + (feed.scrollHeight - prevHeight);

  void hydrateMessageAttachments(feed);
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
  void hydrateMessageAttachments(feed);
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
    if (error && noteAttachmentDimensionSupport(error)) {
      query = supabaseClient
        .from("group_messages")
        .select(withAttachmentColumns(selectBase))
        .eq("chat_id", groupId)
        .order("created_at", { ascending: true });
      if (lastFeedMessageAt) query = query.gte("created_at", lastFeedMessageAt);
      ({ data, error } = await query);
    }
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
      await syncGroupOutgoingReceipts();
      return;
    }
    const rows = data || [];
    if (rows.length) {
      appendMessagesToFeed(rows);
      const latestAt = rows.reduce((max, row) => {
        const at = row.created_at || "";
        return !max || at > max ? at : max;
      }, lastFeedMessageAt || "");
      if (groupId && latestAt) await markGroupChatRead(groupId, latestAt);
      void refreshMessagesUnreadBadge();
    }
    await syncGroupOutgoingReceipts();
    return;
  }

  const peerFilter = `and(sender_id.eq.${uid},recipient_id.eq.${activePeerId}),and(sender_id.eq.${activePeerId},recipient_id.eq.${uid})`;
  let query = supabaseClient
    .from("user_messages")
    .select(messageSelectColumns())
    .or(peerFilter)
    .order("created_at", { ascending: true });

  if (lastFeedMessageAt) {
    query = query.gte("created_at", lastFeedMessageAt);
  }

  let { data, error } = await query;
  if (error && noteAttachmentDimensionSupport(error)) {
    let retry = supabaseClient
      .from("user_messages")
      .select(messageSelectColumns())
      .or(peerFilter)
      .order("created_at", { ascending: true });
    if (lastFeedMessageAt) retry = retry.gte("created_at", lastFeedMessageAt);
    ({ data, error } = await retry);
  }
  if (error && noteAttachmentSupport(error)) {
    let retry = supabaseClient
      .from("user_messages")
      .select(messageSelectColumns())
      .or(peerFilter)
      .order("created_at", { ascending: true });
    if (lastFeedMessageAt) retry = retry.gte("created_at", lastFeedMessageAt);
    ({ data, error } = await retry);
  }
  if (error && noteDeliveredAtSupport(error) && deliveredAtSupported === false) {
    let retry = supabaseClient
      .from("user_messages")
      .select(messageSelectColumns())
      .or(peerFilter)
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

  const rows = data || [];
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
  const chunkSize = 200;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { error } = await supabaseClient
      .from("user_messages")
      .update({ delivered_at: now })
      .in("id", chunk)
      .eq("recipient_id", uid)
      .is("delivered_at", null);

    if (error) {
      if (noteDeliveredAtSupport(error)) return;
      console.warn("Ошибка отметки доставленных:", error);
      return;
    }
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
  if (!uid) return;

  if (deliveredAtSupported !== false) {
    const { data, error } = await fetchAllSupabaseRows(() =>
      supabaseClient
        .from("user_messages")
        .select("id")
        .eq("recipient_id", uid)
        .is("delivered_at", null)
        .is("read_at", null)
        .order("id", { ascending: true }),
    );

    if (error) {
      if (!noteDeliveredAtSupport(error)) {
        console.warn("Не удалось проверить недоставленные входящие:", error);
      }
    } else {
      deliveredAtSupported = true;
      const ids = (data || []).map((row) => row.id);
      if (ids.length) {
        await markIncomingMessagesDelivered(ids);
      }
    }
  }

  await acknowledgeGroupMessagesDelivered();
}

/** Число непрочитанных входящих в групповых чатах текущего пользователя. */
async function countUnreadGroupMessagesTotal() {
  if (groupChatsSupported === false) return 0;

  const uid = getCurrentUserId();
  if (!uid) return 0;

  let chats = [...groupChatsById.values()];
  if (!chats.length) {
    const { chats: fetched, error } = await fetchMyGroupChats();
    if (error || !fetched?.length) return 0;
    chats = fetched;
  }

  const chatIds = chats.map((chat) => chat.id);
  if (!chatIds.length) return 0;

  const lastReadByChat = await fetchGroupChatReads(chatIds);
  const unreadByChat = await fetchGroupUnreadCounts(chatIds, uid, lastReadByChat);

  let total = 0;
  const activeGroupId = isGroupChat() ? parseGroupId() : null;
  for (const chat of chats) {
    // Открытый сейчас групповой чат считаем прочитанным.
    if (activeGroupId && chat.id === activeGroupId) continue;
    total += unreadByChat.get(String(chat.id)) || unreadByChat.get(chat.id) || 0;
  }
  return total;
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

  const dmUnread = count || 0;
  let groupUnread = 0;
  try {
    groupUnread = await countUnreadGroupMessagesTotal();
  } catch (err) {
    console.warn("Не удалось получить число непрочитанных групповых:", err);
  }

  const n = dmUnread + groupUnread;
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
  const cropBtn = document.getElementById("messagesPendingAttachmentCrop");
  if (thumb) {
    thumb.removeAttribute("src");
    thumb.alt = "";
  }
  if (cropBtn) cropBtn.hidden = true;
  if (wrap) wrap.hidden = true;
}

function setPendingChatPhoto(file) {
  clearPendingChatPhoto();
  if (!file) return;
  const previewUrl = URL.createObjectURL(file);
  pendingChatPhoto = { file, previewUrl };
  const wrap = document.getElementById("messagesPendingAttachment");
  const thumb = document.getElementById("messagesPendingAttachmentThumb");
  const cropBtn = document.getElementById("messagesPendingAttachmentCrop");
  if (thumb) {
    thumb.src = previewUrl;
    thumb.alt = file.name || "Фото";
  }
  if (cropBtn) cropBtn.hidden = !isCroppableImageFile(file);
  if (wrap) wrap.hidden = false;
}

function setAttachPhotoMenuOpen(open) {
  const menu = document.getElementById("messagesAttachPhotoMenu");
  const btn = document.getElementById("messagesAttachPhotoBtn");
  if (menu) menu.hidden = !open;
  if (btn) {
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.classList.toggle("messages-composer-tool-btn--active", open);
    btn.title = open ? "Закрыть вложения" : "Вложение";
    btn.setAttribute("aria-label", open ? "Закрыть вложения" : "Вложение");
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

  /* Сразу в превью — обрезка опциональна через кнопку у вложения. */
  setPendingChatPhoto(file);
  if (msg) {
    msg.textContent = "";
    msg.classList.remove("messages-page-message--error");
  }
}

async function handlePendingChatPhotoCrop() {
  const file = pendingChatPhoto?.file;
  if (!file || !isCroppableImageFile(file)) return;

  const cropped = await cropImageAttachment(file);
  if (cropped === null) return;
  setPendingChatPhoto(cropped);
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
  actionMenuPointerDown = false;
  actionMenuArmed = null;
  document.querySelector(".message-item--menu-open")?.classList.remove("message-item--menu-open");
}

function isActionMenuDismissGraceActive() {
  return Date.now() - actionMenuOpenedAt < ACTION_MENU_DISMISS_GRACE_MS;
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
  actionMenuOpenedAt = Date.now();
  actionMenuPointerDown = false;
  actionMenuArmed = null;

  clearMessageTextSelection();
  requestAnimationFrame(() => {
    clearMessageTextSelection();
    setTimeout(clearMessageTextSelection, 50);
  });

  document.querySelector(".message-item--menu-open")?.classList.remove("message-item--menu-open");
  messageEl.classList.add("message-item--menu-open");

  const replyBtn = menu.querySelector('[data-action="reply"]');
  const copyBtn = menu.querySelector('[data-action="copy"]');
  const createTaskBtn = menu.querySelector('[data-action="create-task"]');
  const editBtn = menu.querySelector('[data-action="edit"]');
  const attachBtn = menu.querySelector('[data-action="attach-to-order"]');
  const deleteBtn = menu.querySelector('[data-action="delete"]');
  if (replyBtn) replyBtn.hidden = false;
  if (copyBtn) copyBtn.hidden = !getMessageCopyText(row);
  if (createTaskBtn) createTaskBtn.hidden = !getMessageCopyText(row);
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
  // focus после закрытия меню — иначе на iOS первый жест иногда «съедается»
  // системным UI/scroll и клавиатура не открывается.
  queueMicrotask(() => {
    const input = document.getElementById("messagesComposerInput");
    input?.focus();
  });
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
  }
  syncComposerContextBar();
  hideMessageActionMenu();
  queueMicrotask(() => {
    const inputEl = document.getElementById("messagesComposerInput");
    if (!inputEl) return;
    inputEl.focus();
    const len = inputEl.value.length;
    inputEl.setSelectionRange(len, len);
  });
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

function runMessageAction(action, messageId) {
  if (!action || messageId == null || messageId === "") return false;
  const now = Date.now();
  if (now - actionMenuHandledAt < ACTION_MENU_ACTION_DEDUP_MS) return false;
  actionMenuHandledAt = now;

  const row = feedMessagesById.get(String(messageId));
  hideMessageActionMenu();
  longPressTriggered = false;
  if (!row) return false;

  if (action === "reply") {
    startReplyToMessage(row);
    return true;
  }
  if (action === "copy") {
    void copyMessageText(row);
    return true;
  }
  if (action === "create-task") {
    const text = getMessageCopyText(row);
    if (!text) return false;
    queueMicrotask(() => {
      void import("./task-create-dialog.js").then((m) => m.openTaskCreateDialog({ body: text }));
    });
    return true;
  }
  if (action === "edit") {
    startEditMessage(row);
    return true;
  }
  if (action === "attach-to-order") {
    const meta = readAttachPhotoMetaFromRow(row);
    if (!meta) return false;
    // Открываем после текущего pointer/click, иначе document-слушатель сразу закроет список заказов.
    queueMicrotask(() => openAttachPhotoToOrderPicker(meta));
    return true;
  }
  if (action === "delete") {
    void deleteOwnMessage(row);
    return true;
  }
  return false;
}

function onMessageActionMenuPointerDown(e) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  const btn = e.target.closest("[data-action]");
  if (!btn || btn.hidden) {
    actionMenuArmed = null;
    return;
  }
  const action = btn.getAttribute("data-action");
  if (!action || actionMenuMessageId == null) {
    actionMenuArmed = null;
    return;
  }
  actionMenuPointerDown = true;
  // Снимок id на pointerdown: к моменту pointerup/click меню могли закрыть scroll/ghost-click.
  actionMenuArmed = {
    action,
    messageId: String(actionMenuMessageId),
    pointerId: e.pointerId,
  };
}

function onMessageActionMenuPointerUp(e) {
  const armed = actionMenuArmed;
  actionMenuPointerDown = false;
  if (!armed || armed.pointerId !== e.pointerId) {
    actionMenuArmed = null;
    return;
  }
  const btn = e.target.closest("[data-action]");
  actionMenuArmed = null;
  if (!btn || btn.getAttribute("data-action") !== armed.action) return;
  e.preventDefault();
  e.stopPropagation();
  runMessageAction(armed.action, armed.messageId);
}

function onMessageActionMenuPointerCancel() {
  actionMenuPointerDown = false;
  actionMenuArmed = null;
}

function onMessageActionMenuClick(e) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  const action = btn.getAttribute("data-action");
  // messageId мог уже сброситься hideMessageActionMenu — берём из armed, если ещё есть.
  const messageId =
    actionMenuArmed?.action === action
      ? actionMenuArmed.messageId
      : actionMenuMessageId;
  actionMenuArmed = null;
  actionMenuPointerDown = false;
  if (!action || messageId == null) return;
  runMessageAction(action, messageId);
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

    let { error } = await supabaseClient.from("group_messages").insert({
      chat_id: groupId,
      sender_id: uid,
      sender_email: getCurrentUserEmail(),
      body,
      ...attachmentPayload,
      ...replyPayload,
    });

    if (error && noteAttachmentDimensionSupport(error) && attachmentPayload.attachment_width != null) {
      ({ error } = await supabaseClient.from("group_messages").insert({
        chat_id: groupId,
        sender_id: uid,
        sender_email: getCurrentUserEmail(),
        body,
        ...stripAttachmentDimensionFields(attachmentPayload),
        ...replyPayload,
      }));
    }

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

  let { error } = await supabaseClient.from("user_messages").insert(inserts);

  if (error && noteAttachmentDimensionSupport(error) && attachmentPayload.attachment_width != null) {
    const insertsWithoutDims = inserts.map(stripAttachmentDimensionFields);
    ({ error } = await supabaseClient.from("user_messages").insert(insertsWithoutDims));
  }

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

function clearGroupFormAvatarPreview() {
  if (groupFormAvatarObjectUrl) {
    URL.revokeObjectURL(groupFormAvatarObjectUrl);
    groupFormAvatarObjectUrl = null;
  }
  groupFormAvatarFile = null;
}

function resetGroupFormAvatarState() {
  clearGroupFormAvatarPreview();
  groupFormAvatarExistingPath = null;
  groupFormAvatarRemoved = false;
  const input = document.getElementById("messagesCreateGroupAvatarInput");
  if (input) input.value = "";
  updateGroupFormAvatarPreview();
}

function updateGroupFormAvatarPreview() {
  const preview = document.getElementById("messagesCreateGroupAvatarPreview");
  const initialEl = document.getElementById("messagesCreateGroupAvatarInitial");
  const imgEl = document.getElementById("messagesCreateGroupAvatarImg");
  const clearBtn = document.getElementById("messagesCreateGroupAvatarClearBtn");
  const nameInput = document.getElementById("messagesCreateGroupName");
  if (!preview || !initialEl || !imgEl) return;

  const name = nameInput?.value?.trim() || "";
  initialEl.textContent = avatarInitial(name || "?");
  const hue = avatarHue(editingGroupId ? toGroupPeerId(editingGroupId) : name || "group");
  preview.style.background = `hsl(${hue} 55% 88%)`;
  preview.style.color = `hsl(${hue} 45% 32%)`;

  const hasExisting = Boolean(groupFormAvatarExistingPath && !groupFormAvatarRemoved);
  const showClear = Boolean(groupFormAvatarFile || hasExisting);
  if (clearBtn) clearBtn.hidden = !showClear;

  if (groupFormAvatarObjectUrl) {
    imgEl.src = groupFormAvatarObjectUrl;
    imgEl.hidden = false;
    initialEl.hidden = true;
    return;
  }

  if (hasExisting && imgEl.getAttribute("src")) {
    imgEl.hidden = false;
    initialEl.hidden = true;
    return;
  }

  imgEl.removeAttribute("src");
  imgEl.hidden = true;
  initialEl.hidden = false;
}

async function loadExistingGroupAvatarPreview(storagePath) {
  const imgEl = document.getElementById("messagesCreateGroupAvatarImg");
  const initialEl = document.getElementById("messagesCreateGroupAvatarInitial");
  const clearBtn = document.getElementById("messagesCreateGroupAvatarClearBtn");
  if (!storagePath || !imgEl || !initialEl) return;
  try {
    const url = await resolveGroupAvatarUrl(storagePath);
    if (!url) return;
    if (groupFormAvatarFile || groupFormAvatarRemoved || groupFormAvatarExistingPath !== storagePath) {
      return;
    }
    imgEl.src = url;
    imgEl.hidden = false;
    initialEl.hidden = true;
    if (clearBtn) clearBtn.hidden = false;
  } catch (err) {
    console.warn("Не удалось загрузить текущий аватар группы:", err);
  }
}

function setGroupFormAvatarFile(file) {
  clearGroupFormAvatarPreview();
  if (!file) {
    updateGroupFormAvatarPreview();
    return;
  }
  groupFormAvatarFile = file;
  groupFormAvatarRemoved = false;
  groupFormAvatarObjectUrl = URL.createObjectURL(file);
  updateGroupFormAvatarPreview();
}

function clearGroupFormAvatarSelection() {
  clearGroupFormAvatarPreview();
  groupFormAvatarRemoved = true;
  const input = document.getElementById("messagesCreateGroupAvatarInput");
  if (input) input.value = "";
  updateGroupFormAvatarPreview();
}

function closeCreateGroupDialog() {
  const dialog = document.getElementById("messagesCreateGroupDialog");
  if (dialog?.open) dialog.close();
  setCreateGroupError("");
  groupFormMode = "create";
  editingGroupId = null;
  resetGroupFormAvatarState();
}

function renderGroupFormUsers(usersEl, selectedIds) {
  const uid = getCurrentUserId();
  const selected = new Set((selectedIds || []).map(String));
  const users = usersCache || [];
  const others = users.filter((u) => String(u.id) !== String(uid));

  usersEl.innerHTML = others.length
    ? others
        .map((user) => {
          const name = displayNameByEmail(user.email) || user.email || "—";
          const checked = selected.has(String(user.id)) ? " checked" : "";
          return `
            <label class="messages-create-group-user">
              <input type="checkbox" value="${escapeHtml(user.id)}" data-email="${escapeHtml(user.email)}"${checked} />
              <span class="messages-create-group-user-name">${escapeHtml(name)}</span>
            </label>
          `;
        })
        .join("")
    : `<p class="messages-page-message">Нет доступных пользователей.</p>`;
}

async function openGroupFormDialog({ mode, chat = null } = {}) {
  const dialog = document.getElementById("messagesCreateGroupDialog");
  const nameInput = document.getElementById("messagesCreateGroupName");
  const usersEl = document.getElementById("messagesCreateGroupUsers");
  const titleEl = document.getElementById("messagesCreateGroupDialogTitle");
  if (!dialog || !usersEl) return;

  groupFormMode = mode === "edit" ? "edit" : "create";
  editingGroupId = groupFormMode === "edit" && chat?.id ? String(chat.id) : null;
  setCreateGroupError("");
  resetGroupFormAvatarState();

  if (titleEl) {
    titleEl.textContent = groupFormMode === "edit" ? "Изменить групповой чат" : "Новый групповой чат";
  }

  await loadUsersDirectory();

  if (groupFormMode === "edit" && chat) {
    if (nameInput) nameInput.value = chat.name || "";
    renderGroupFormUsers(usersEl, chat.memberIds || []);
    groupFormAvatarExistingPath = chat.avatarStoragePath || null;
    groupFormAvatarRemoved = false;
    updateGroupFormAvatarPreview();
    if (groupFormAvatarExistingPath) {
      void loadExistingGroupAvatarPreview(groupFormAvatarExistingPath);
    }
  } else {
    if (nameInput) nameInput.value = "";
    renderGroupFormUsers(usersEl, []);
    updateGroupFormAvatarPreview();
  }

  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
  nameInput?.focus();
}

async function openCreateGroupDialog() {
  await openGroupFormDialog({ mode: "create" });
}

async function openEditGroupDialog() {
  if (!isGroupChat()) return;
  const groupId = parseGroupId();
  if (!groupId) return;

  if (!groupChatsById.has(groupId)) {
    await fetchMyGroupChats();
  }
  const chat = groupChatsById.get(groupId);
  if (!chat) {
    setCreateGroupError("");
    const msg = document.getElementById("messagesPageMessage");
    if (msg) {
      msg.textContent = "Групповой чат не найден.";
      msg.classList.add("messages-page-message--error");
    }
    return;
  }

  await openGroupFormDialog({ mode: "edit", chat });
}

async function resolveGroupFormAvatarPath() {
  if (groupFormAvatarFile) {
    const uploaded = await uploadChatPhoto(groupFormAvatarFile);
    return uploaded.storagePath;
  }
  if (groupFormMode === "edit") {
    if (groupFormAvatarRemoved) return null;
    return groupFormAvatarExistingPath || null;
  }
  return null;
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

  let avatarStoragePath = null;
  try {
    if (groupFormAvatarFile || (groupFormMode === "edit" && (groupFormAvatarRemoved || groupFormAvatarExistingPath))) {
      avatarStoragePath = await resolveGroupFormAvatarPath();
    }
  } catch (err) {
    console.error("Ошибка загрузки картинки группы:", err);
    if (saveBtn) saveBtn.disabled = false;
    setCreateGroupError(err?.message || "Не удалось загрузить картинку чата.");
    return;
  }

  if (groupFormMode === "edit") {
    const groupId = editingGroupId;
    if (!groupId) {
      if (saveBtn) saveBtn.disabled = false;
      setCreateGroupError("Не удалось определить групповой чат.");
      return;
    }

    const payload = {
      name,
      member_ids: memberIds,
    };
    if (groupAvatarSupported !== false) {
      payload.avatar_storage_path = avatarStoragePath;
    }

    let { data, error } = await supabaseClient
      .from("group_chats")
      .update(payload)
      .eq("id", groupId)
      .select(groupChatSelectColumns())
      .single();

    if (error && noteGroupAvatarSupport(error) && "avatar_storage_path" in payload) {
      delete payload.avatar_storage_path;
      ({ data, error } = await supabaseClient
        .from("group_chats")
        .update(payload)
        .eq("id", groupId)
        .select(groupChatSelectColumns())
        .single());
    }

    if (saveBtn) saveBtn.disabled = false;

    if (error) {
      console.error("Ошибка обновления группового чата:", error);
      const msg = `${error.message || ""} ${error.details || ""} ${error.hint || ""}`.toLowerCase();
      setCreateGroupError(
        noteGroupChatsSupport(error)
          ? "Таблицы групповых чатов не созданы. Выполните supabase_group_chats.sql в Supabase."
          : msg.includes("permission") || msg.includes("policy") || error.code === "42501"
            ? "Нет прав на изменение группы. Выполните supabase_group_chats_edit.sql в Supabase."
            : "Не удалось сохранить изменения группового чата.",
      );
      return;
    }

    const previousAvatarPath = groupChatsById.get(groupId)?.avatarStoragePath || null;
    const chat = mapGroupChatRow(data || { id: groupId, name, created_by: uid, member_ids: memberIds, avatar_storage_path: avatarStoragePath });
    groupChatsById.set(chat.id, chat);
    groupChatsSupported = true;
    if (groupAvatarSupported !== false && Object.prototype.hasOwnProperty.call(payload, "avatar_storage_path")) {
      groupAvatarSupported = true;
    }
    if (previousAvatarPath && previousAvatarPath !== chat.avatarStoragePath) {
      invalidateGroupAvatarUrlCache(previousAvatarPath);
    }
    if (chat.avatarStoragePath && chat.avatarStoragePath !== previousAvatarPath) {
      invalidateGroupAvatarUrlCache(chat.avatarStoragePath);
    }

    closeCreateGroupDialog();
    updateDialogHeader();
    if (messagesView === "list") {
      void loadChatList();
    }
    return;
  }

  const insertPayload = {
    name,
    created_by: uid,
    member_ids: memberIds,
  };
  if (groupAvatarSupported !== false && avatarStoragePath) {
    insertPayload.avatar_storage_path = avatarStoragePath;
  }

  let { data, error } = await supabaseClient
    .from("group_chats")
    .insert(insertPayload)
    .select(groupChatSelectColumns())
    .single();

  if (error && noteGroupAvatarSupport(error) && "avatar_storage_path" in insertPayload) {
    delete insertPayload.avatar_storage_path;
    ({ data, error } = await supabaseClient
      .from("group_chats")
      .insert(insertPayload)
      .select(groupChatSelectColumns())
      .single());
  }

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

  const chat = mapGroupChatRow(data);
  groupChatsById.set(chat.id, chat);
  groupChatsSupported = true;
  if (groupAvatarSupported !== false && insertPayload.avatar_storage_path) {
    groupAvatarSupported = true;
  }

  closeCreateGroupDialog();
  await openMessagesDialog(toGroupPeerId(chat.id));
}

let messagesSectionInited = false;

export function initMessagesSection() {
  if (messagesSectionInited) return;
  messagesSectionInited = true;
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
  const editGroupBtn = document.getElementById("messagesEditGroupBtn");
  const groupAvatarPickBtn = document.getElementById("messagesCreateGroupAvatarPickBtn");
  const groupAvatarClearBtn = document.getElementById("messagesCreateGroupAvatarClearBtn");
  const groupAvatarInput = document.getElementById("messagesCreateGroupAvatarInput");
  const createGroupNameInput = document.getElementById("messagesCreateGroupName");

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

  if (editGroupBtn) {
    editGroupBtn.addEventListener("click", () => {
      void openEditGroupDialog();
    });
  }

  if (groupAvatarPickBtn && groupAvatarInput) {
    groupAvatarPickBtn.addEventListener("click", () => {
      groupAvatarInput.click();
    });
  }

  if (groupAvatarClearBtn) {
    groupAvatarClearBtn.addEventListener("click", () => {
      clearGroupFormAvatarSelection();
    });
  }

  if (groupAvatarInput) {
    groupAvatarInput.addEventListener("change", () => {
      const file = groupAvatarInput.files?.[0] || null;
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setCreateGroupError("Выберите файл изображения.");
        groupAvatarInput.value = "";
        return;
      }
      setCreateGroupError("");
      setGroupFormAvatarFile(file);
    });
  }

  if (createGroupNameInput) {
    createGroupNameInput.addEventListener("input", () => {
      updateGroupFormAvatarPreview();
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
    actionMenu.addEventListener("pointerdown", onMessageActionMenuPointerDown);
    actionMenu.addEventListener("pointerup", onMessageActionMenuPointerUp);
    actionMenu.addEventListener("pointercancel", onMessageActionMenuPointerCancel);
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
  const pendingCropBtn = document.getElementById("messagesPendingAttachmentCrop");

  if (userPickBtn && input) {
    userPickBtn.addEventListener("mousedown", (e) => e.preventDefault());
    userPickBtn.addEventListener("click", () => {
      if (isPeerChat() || isGroupChat()) return;
      void loadUsersDirectory().then(() => openUserPicker(input));
    });
  }

  if (orderPickBtn && input) {
    orderPickBtn.addEventListener("mousedown", (e) => e.preventDefault());
    orderPickBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeAttachPhotoMenu();
      openOrderPicker(input);
    });
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

  if (pendingCropBtn) {
    pendingCropBtn.addEventListener("click", () => {
      void handlePendingChatPhotoCrop();
    });
  }

  if (pendingRemoveBtn) {
    pendingRemoveBtn.addEventListener("click", () => {
      clearPendingChatPhoto();
    });
  }

  document.addEventListener("click", (e) => {
    const menu = document.getElementById("messagesActionMenu");
    if (
      menu &&
      !menu.hidden &&
      !menu.contains(e.target) &&
      !e.target.closest(".message-item--menu-open") &&
      !actionMenuPointerDown &&
      !isActionMenuDismissGraceActive()
    ) {
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

  document.addEventListener(
    "scroll",
    () => {
      const menu = document.getElementById("messagesActionMenu");
      if (!menu || menu.hidden) return;
      // Micro-scroll / rubber-band / scrollIntoView на iOS во время tap по «Ответить»
      // раньше закрывали меню до click и сбрасывали actionMenuMessageId.
      if (actionMenuPointerDown || isActionMenuDismissGraceActive()) return;
      hideMessageActionMenu();
    },
    true,
  );

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
