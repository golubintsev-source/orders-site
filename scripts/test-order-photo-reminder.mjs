import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
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
assert.match(swSource, /orders-site-static-v145/);

const cooldownSource = ordersSource.slice(
  ordersSource.indexOf("let orderFormSaveInFlight = false;"),
  ordersSource.indexOf("function showNewOrderPhotoReminder()"),
);
const photoCheckSource = ordersSource.slice(
  ordersSource.indexOf("  const hasPendingPhoto = hasPendingPhotoAttachment();"),
  ordersSource.indexOf('  setMessage("Сохраняю..."'),
);

for (const minutes of [3, 5]) {
  let now = 1_000_000;
  let hasPhoto = false;
  const storage = new Map([["orders-site-photo-cooldown-until", String(now - 1)]]);
  const warning = { hidden: true, scrollIntoView() {} };
  const clock = {};
  const reminder = { hidden: true };
  const submitBtn = { disabled: false };
  const submitBtnTop = { disabled: false };
  const state = { editingOrderId: null };
  const { openNewOrder, canSave, updatePhotoCooldownUI } = runInNewContext(
    `${cooldownSource}
    function openNewOrder() {
      newOrderPhotoReminderAcknowledged = false;
      restorePhotoCooldown();
    }
    function canSave() {
      ${photoCheckSource}
      return true;
    }
    ({ openNewOrder, canSave, updatePhotoCooldownUI });`,
    {
      Date: { now: () => now },
      localStorage: {
        getItem: (key) => storage.get(key),
        setItem: (key, value) => storage.set(key, value),
        removeItem: (key) => storage.delete(key),
      },
      document: { getElementById: (id) => ({
        orderPhotoStrictWarning: warning,
        orderPhotoCooldownClock: clock,
        orderPhotoReminder: reminder,
      })[id] },
      submitBtn,
      submitBtnTop,
      state,
      getOrderPhotoCooldownMinutes: () => minutes,
      hasPendingPhotoAttachment: () => hasPhoto,
      shouldPauseNewOrderSaveForPhoto,
      showNewOrderPhotoReminder: () => { reminder.hidden = false; },
      setMessage() {},
      setInterval: () => 1,
      clearInterval() {},
    },
  );

  openNewOrder();
  assert.equal(canSave(), undefined, "Первое нажатие показывает напоминание");
  assert.equal(reminder.hidden, false);
  assert.equal(submitBtn.disabled, false);
  assert.equal(canSave(), undefined, "Истёкший таймер прошлого заказа не отменяет новую блокировку");
  assert.equal(warning.hidden, false);
  assert.equal(clock.textContent, `0${minutes}:00`);
  assert.equal(submitBtn.disabled, true);
  assert.equal(submitBtnTop.disabled, true);

  openNewOrder();
  now += minutes * 60_000 - 1;
  assert.equal(canSave(), undefined, "Действующая блокировка восстанавливается при открытии формы");
  now++;
  updatePhotoCooldownUI();
  assert.equal(submitBtn.disabled, false);
  assert.equal(submitBtnTop.disabled, false);
  assert.equal(warning.hidden, true);
  assert.equal(canSave(), true, "По истечении таймера можно сохранить");

  openNewOrder();
  assert.equal(canSave(), undefined);
  assert.equal(canSave(), undefined, "В следующем заказе запускается новый таймер");
  hasPhoto = true;
  updatePhotoCooldownUI();
  assert.equal(submitBtn.disabled, false);
  assert.equal(canSave(), true, "Фото снимает блокировку");
  hasPhoto = false;
  state.editingOrderId = 1419;
  assert.equal(canSave(), true, "Редактирование заказа не требует нового фото");
}

console.log("order photo reminder tests: ok");
