import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../js/access-log.js", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  /const ACCESS_LOG_BATCH_SIZE = 50/.test(source),
  "access logs must use bounded batches",
);
assert(
  /from\("site_access_logs"\)\.insert\(rows\)/.test(source),
  "one Data API insert must carry the whole batch",
);
assert(
  /offset \+= ACCESS_LOG_BATCH_SIZE/.test(source),
  "offline queue must flush in batches instead of one transaction per row",
);
assert(
  /const ACCESS_LOG_DEDUPE_MS = 10_000/.test(source) && /isDuplicateAccess/.test(source),
  "rapid duplicate SPA transitions must be ignored",
);
assert(
  /const ACCESS_LOG_FLUSH_DELAY_MS = 20_000/.test(source),
  "normal transitions must wait for the shared flush window",
);

console.log("test-access-log-batching: ok");
