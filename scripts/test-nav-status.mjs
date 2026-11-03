import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../js/nav-status.js", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  /const NAV_STATUS_FALLBACK_MS = 10 \* 60_000/.test(source),
  "nav status fallback must run once per 10 minutes",
);
assert(
  !/setInterval\(\(\) => void refreshNavStatus\(\), 60_000\)/.test(source),
  "one-minute global polling must stay removed",
);
assert(
  /table: "order_tasks"/.test(source) && /scheduleTaskStatusRefresh/.test(source),
  "task badge must react to order_tasks Realtime events",
);
assert(
  /table: "user_messages"/.test(source) && /table: "group_messages"/.test(source),
  "message badge must react to message Realtime events",
);
assert(
  /messages-status-ready/.test(source) && /stopMessageStatusRealtime/.test(source),
  "lightweight message status channel must stop when full chat sync starts",
);
assert(
  /NAV_STATUS_EVENT_DEBOUNCE_MS/.test(source),
  "bursts of Realtime events must be debounced",
);

console.log("test-nav-status: ok");
