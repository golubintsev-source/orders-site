import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const messagesSource = await readFile(new URL("../js/messages.js", import.meta.url), "utf8");
const navSource = await readFile(new URL("../js/section-nav.js", import.meta.url), "utf8");
const styleSource = await readFile(new URL("../style.css", import.meta.url), "utf8");
const swSource = await readFile(new URL("../sw.js", import.meta.url), "utf8");

assert.match(navSource, /window\.innerHeight - vv\.height/);
assert.match(navSource, /stableViewportHeight - vv\.height/);
assert.doesNotMatch(navSource, /window\.innerHeight - vv\.height - vv\.offsetTop/);
assert.match(messagesSource, /function keepActiveComposerAtBottom|const keepActiveComposerAtBottom/);
assert.match(messagesSource, /input\.addEventListener\("focus"/);
assert.match(messagesSource, /visualViewport\?\.addEventListener\("resize", keepActiveComposerAtBottom\)/);
assert.match(messagesSource, /function resetChatDocumentScroll|const resetChatDocumentScroll/);
assert.match(messagesSource, /scrollingElement\.scrollTop = 0/);
assert.match(messagesSource, /window\.scrollTo\(0, 0\)/);
assert.match(messagesSource, /sendBtn\.addEventListener\("pointerdown"/);
assert.match(messagesSource, /e\.pointerType !== "touch" && e\.pointerType !== "pen"/);
assert.match(messagesSource, /composerSendTouchHandledAt < 800/);
assert.match(messagesSource, /function requestSendMessage/);
assert.match(messagesSource, /if \(composerSendPromise\) return composerSendPromise/);
assert.match(styleSource, /\.messages-feed[\s\S]*?overflow-anchor: none/);
assert.match(styleSource, /\.messages-composer-input[\s\S]*?caret-color: #059669/);
assert.match(styleSource, /html\.keyboard-open:has\(#section-messages\.content-section\.active\)[\s\S]*?overflow: hidden/);
assert.match(swSource, /orders-site-static-v76/);

console.log("messages iOS composer tests: ok");
