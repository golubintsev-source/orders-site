import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [filesSource, messagesSource, swSource] = await Promise.all([
  readFile(new URL("../js/files.js", import.meta.url), "utf8"),
  readFile(new URL("../js/messages.js", import.meta.url), "utf8"),
  readFile(new URL("../sw.js", import.meta.url), "utf8"),
]);

assert.match(filesSource, /const COMPRESS_MAX_LONG_EDGE = 1600;/);
assert.match(filesSource, /const COMPRESS_TARGET_MAX_BYTES = 320 \* 1024;/);
assert.doesNotMatch(filesSource, /COMPRESS_MIN_BYTES|COMPRESS_MIN_LONG_EDGE/);
assert.match(filesSource, /createSignedUrls\(missing, SIGNED_FILE_URL_TTL_SECONDS\)/);
assert.match(filesSource, /const SIGNED_FILE_URL_CACHE_MS = 9 \* 60 \* 1000;/);

assert.match(messagesSource, /const CHAT_PHOTO_LOAD_CONCURRENCY = 4;/);
assert.match(messagesSource, /loading="lazy"/);
assert.match(messagesSource, /new IntersectionObserver\(/);
assert.match(messagesSource, /const previewUrl = \(thumbPath && signedUrls\.get\(thumbPath\)\) \|\| fullUrl;/);
assert.match(messagesSource, /getSignedFileUrls\(paths\)/);
assert.match(swSource, /orders-site-static-v70/);

console.log("chat photo performance tests: ok");
