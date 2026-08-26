import assert from "node:assert/strict";
import {
  formatMessagePlainTextHtml,
  stripRecipientMentionFromBody,
} from "../js/messages-body.js";

assert.equal(
  stripRecipientMentionFromBody("user@gmail.com", "peer@example.com"),
  "user@gmail.com",
  "plain email must stay in the body",
);
assert.equal(
  stripRecipientMentionFromBody("напиши user@gmail.com пожалуйста", "peer@example.com"),
  "напиши user@gmail.com пожалуйста",
  "email in the middle of the text must stay",
);
assert.equal(
  stripRecipientMentionFromBody("@peer@example.com привет", "peer@example.com"),
  "привет",
  "recipient @email mention is still stripped",
);
assert.equal(
  stripRecipientMentionFromBody("peer@example.com", "peer@example.com"),
  "peer@example.com",
  "recipient email without @ must stay (user pasted it on purpose)",
);

const emailOnly = formatMessagePlainTextHtml("user@gmail.com");
assert.match(emailOnly, /user@gmail\.com/, "email-only message must render the address");
assert.match(emailOnly, /mailto:user@gmail\.com/, "email becomes a mailto link");
assert.doesNotMatch(emailOnly, /message-mention/, "email is not a mention");

const mixed = formatMessagePlainTextHtml("пиши на user@gmail.com и @alex");
assert.match(mixed, /mailto:user@gmail\.com/, "mixed text keeps mailto");
assert.match(mixed, /<span class="message-mention">@alex<\/span>/, "@name is still highlighted");

const mentionOnly = formatMessagePlainTextHtml("@alex привет");
assert.match(mentionOnly, /<span class="message-mention">@alex<\/span> привет/);

assert.equal(formatMessagePlainTextHtml(""), "");
assert.equal(stripRecipientMentionFromBody("", "a@b.com"), "");

assert.match(
  formatMessagePlainTextHtml("<script>alert(1)</script>"),
  /&lt;script&gt;alert\(1\)&lt;\/script&gt;/,
  "html in the body is escaped",
);

console.log("ok");
