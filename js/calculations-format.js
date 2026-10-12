import { isKnownUserDisplayName } from "./user-names.js";
const ORDER_DELTA_CALC_COMMENT_PREFIX = "[AUTO_ORDER_DELTA]";
const EXCESS_DELTA_CALC_COMMENT_PREFIX = "[AUTO_EXCESS_DELTA]";
const CALC_COMMENT_EMPTY = "[__]";

function parseOrderIdFromChip(chip) {
  if (!chip) return null;
  const s = String(chip).trim();
  if (s.startsWith("офл.")) return null;
  const base = s.split("_")[0];
  const n = parseInt(base, 10);
  return Number.isFinite(n) ? n : null;
}

export function parseOrderDeltaCommentOrderId(comment) {
  const c = comment ?? "";
  if (!c.startsWith(ORDER_DELTA_CALC_COMMENT_PREFIX)) return null;
  const body = c.slice(ORDER_DELTA_CALC_COMMENT_PREFIX.length).trim();
  const parts = body.split("; ").map((p) => p.trim());
  if (parts.length < 2) return null;
  return parseOrderIdFromChip(parts[1]);
}

/** У автозаписей заказа в конце комментария «; ЧЧ:ММ; автор» — время не показываем в комментарии. */
function stripOrderDeltaTrailingTime(body) {
  const parts = String(body || "")
    .split("; ")
    .map((p) => p.trim());
  if (parts.length >= 5 && /^\d{2}:\d{2}$/.test(parts[parts.length - 2])) {
    return parts.slice(0, -2).join("; ");
  }
  return body;
}

function isCalcAuthorToken(s) {
  const t = String(s ?? "").trim();
  if (!t) return false;
  // Старый формат короткого логина («golub..») и неизвестный автор.
  if (t === "неизв.." || /\.\.$/.test(t)) return true;
  // Текущий формат: отображаемое имя вошедшего пользователя.
  return isKnownUserDisplayName(t);
}

function extractAuthorFromOrderDeltaBody(body) {
  const parts = String(body || "")
    .split("; ")
    .map((p) => p.trim());
  if (parts.length < 2) return "";
  if (parts.length >= 5 && /^\d{2}:\d{2}$/.test(parts[parts.length - 2])) {
    return parts[parts.length - 1] || "";
  }
  const last = parts[parts.length - 1];
  return isCalcAuthorToken(last) ? last : "";
}

function stripAuthorFromOrderDeltaBody(body) {
  const parts = String(body || "")
    .split("; ")
    .map((p) => p.trim());
  if (parts.length < 2) return body;
  const last = parts[parts.length - 1];
  if (isCalcAuthorToken(last)) {
    return parts.slice(0, -1).join("; ");
  }
  return body;
}

function extractAuthorFromManualComment(comment) {
  const c = String(comment ?? "").trim();
  if (!c) return "";
  const m = c.match(/;\s*([^;]+)$/);
  if (m) {
    const token = m[1].trim();
    return isCalcAuthorToken(token) ? token : "";
  }
  // Комментарий не вводили — в поле только автор.
  return isCalcAuthorToken(c) ? c : "";
}

export function stripAuthorFromManualComment(comment) {
  const c = String(comment ?? "");
  const trimmed = c.trim();
  if (!trimmed) return "";
  const m = c.match(/;\s*([^;]+)$/);
  if (m && isCalcAuthorToken(m[1].trim())) {
    return c.slice(0, m.index).trim();
  }
  if (isCalcAuthorToken(trimmed)) return "";
  return c;
}

export function getCalcDisplayAuthor(comment) {
  const c = comment ?? "";
  if (c.startsWith(ORDER_DELTA_CALC_COMMENT_PREFIX)) {
    const body = c.slice(ORDER_DELTA_CALC_COMMENT_PREFIX.length).trim();
    return extractAuthorFromOrderDeltaBody(body);
  }
  if (c.startsWith(EXCESS_DELTA_CALC_COMMENT_PREFIX)) {
    const body = c.slice(EXCESS_DELTA_CALC_COMMENT_PREFIX.length).trim();
    return extractAuthorFromOrderDeltaBody(body);
  }
  return extractAuthorFromManualComment(c);
}

function isCalcCommentEmptyPart(s) {
  const t = String(s ?? "").trim();
  return t === "" || t === "—" || t === CALC_COMMENT_EMPTY;
}

function formatCalcCommentEmptyPlaceholders(text) {
  if (!text) return text;
  const withPartPlaceholders = text
    .split("; ")
    .map((part) => (part.trim() === "—" ? CALC_COMMENT_EMPTY : part))
    .join("; ");
  return withPartPlaceholders.replace(
    /(кому|оплатил)\s+[−\-—]/g,
    `$1 ${CALC_COMMENT_EMPTY}`
  );
}

function insertAddressAfterClientInDeltaComment(body, address) {
  const addr = String(address ?? "").trim();
  if (!addr || isCalcCommentEmptyPart(addr)) return body;
  const parts = body.split("; ").map((p) => p.trim());
  if (parts.length < 3) return body;
  if (parts[3] === addr) return body;
  if (isCalcCommentEmptyPart(parts[3])) {
    return [...parts.slice(0, 3), addr, ...parts.slice(4)].join("; ");
  }
  return [...parts.slice(0, 3), addr, ...parts.slice(3)].join("; ");
}

export function formatCalcDisplayComment(comment, calcOrderAddressById = new Map()) {
  const c = comment ?? "";
  const isOrderDeltaRow = typeof c === "string" && c.startsWith(ORDER_DELTA_CALC_COMMENT_PREFIX);
  const isExcessDeltaRow = typeof c === "string" && c.startsWith(EXCESS_DELTA_CALC_COMMENT_PREFIX);
  if (!isOrderDeltaRow && !isExcessDeltaRow) {
    return formatCalcCommentEmptyPlaceholders(stripAuthorFromManualComment(c));
  }
  const prefix = isOrderDeltaRow ? ORDER_DELTA_CALC_COMMENT_PREFIX : EXCESS_DELTA_CALC_COMMENT_PREFIX;
  const body = c.slice(prefix.length).trim();
  let display = stripOrderDeltaTrailingTime(body);
  if (isOrderDeltaRow) {
    const orderId = parseOrderDeltaCommentOrderId(c);
    if (orderId != null && calcOrderAddressById.has(orderId)) {
      display = insertAddressAfterClientInDeltaComment(display, calcOrderAddressById.get(orderId));
    }
  }
  return formatCalcCommentEmptyPlaceholders(stripAuthorFromOrderDeltaBody(display));
}
