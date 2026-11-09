import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { shouldPauseNewOrderSaveForPhoto } from "../js/order-photo-reminder-utils.js";

assert.equal(
  shouldPauseNewOrderSaveForPhoto({ editingOrderId: null, hasPhoto: false, alreadyPrompted: false }),
  true,
);
assert.equal(
  shouldPauseNewOrderSaveForPhoto({ editingOrderId: null, hasPhoto: false, alreadyPrompted: true }),
  false,
);
assert.equal(
  shouldPauseNewOrderSaveForPhoto({ editingOrderId: null, hasPhoto: true, alreadyPrompted: false }),
  false,
);
assert.equal(
  shouldPauseNewOrderSaveForPhoto({ editingOrderId: 1419, hasPhoto: false, alreadyPrompted: false }),
  false,
);

const ordersSource = await readFile(new URL("../js/orders.js", import.meta.url), "utf8");
const filesSource = await readFile(new URL("../js/files.js", import.meta.url), "utf8");
const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const styleSource = await readFile(new URL("../style.css", import.meta.url), "utf8");
const swSource = await readFile(new URL("../sw.js", import.meta.url), "utf8");

assert.match(filesSource, /export function hasPendingPhotoAttachment\(\)/);
assert.match(ordersSource, /newOrderPhotoReminderAcknowledged = true/);
assert.match(ordersSource, /Повторная попытка без фото приведёт к временной блокировке/);
assert.ok(
  ordersSource.indexOf("shouldPauseNewOrderSaveForPhoto") < ordersSource.indexOf('setMessage("Сохраняю..."'),
);
assert.match(indexSource, /id="orderPhotoReminder"/);
assert.match(indexSource, /повторная попытка сохранения запустит временную блокировку/);
assert.match(styleSource, /\.order-photo-reminder/);
assert.match(swSource, /orders-site-static-v140/);

console.log("order photo reminder tests: ok");
