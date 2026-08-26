/**
 * Текст пузыря чата: упоминания получателя, e-mail и @mentions.
 * Без DOM — покрывается scripts/test-messages-body.mjs.
 */

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Убирает только авто-упоминание собеседника вида @email.
 * Адреса в самом тексте сообщения не трогаем — иначе пузырь с e-mail становится пустым.
 */
export function stripRecipientMentionFromBody(body, recipientEmail) {
  const text = String(body || "");
  const email = String(recipientEmail || "").trim();
  if (!text || !email) return text.trim();
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`@${escaped}\\s*`, "gi"), "").trim();
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Подсветка @mentions и кликабельные mailto, без превращения e-mail в mention. */
export function formatMessagePlainTextHtml(raw) {
  const escaped = escapeHtml(raw);
  if (!escaped) return "";

  const emails = [];
  const withPlaceholders = escaped.replace(EMAIL_RE, (email) => {
    const idx = emails.length;
    emails.push(email);
    return `\u0000E${idx}\u0000`;
  });

  const withMentions = withPlaceholders.replace(
    /(^|[^\w.+-])@([\w.+-]+)/g,
    (_, prefix, name) => `${prefix}<span class="message-mention">@${name}</span>`,
  );

  return withMentions.replace(/\u0000E(\d+)\u0000/g, (_, idx) => {
    const email = emails[Number(idx)];
    return `<a href="mailto:${email}" class="message-email-link">${email}</a>`;
  });
}
