import assert from "node:assert/strict";
import {
  recipientSelectLostStoredValue,
  recoverLostRecipientFormValue,
  overlayHistorySnapshotWithParticipants,
  recoverLostMoneyRecipientsInOrderData,
  shouldLockKassaBeznalRecipientSelect,
  preserveLockedKassaBeznalRecipient,
} from "../js/order-money-recipients.js";

const liteOptionsWithoutBeznal = ["", "Дима", "Вова"];
const fullOptions = ["", "Дима", "Вова", "Безнал", "Касса"];

assert.equal(recipientSelectLostStoredValue(liteOptionsWithoutBeznal, "Безнал", null), true);
assert.equal(recipientSelectLostStoredValue(liteOptionsWithoutBeznal, "Безнал", ""), true);
assert.equal(recipientSelectLostStoredValue(fullOptions, "Безнал", null), false);
assert.equal(recipientSelectLostStoredValue(fullOptions, "Безнал", ""), false);
assert.equal(recipientSelectLostStoredValue(fullOptions, "Безнал", "Дима"), false);
assert.equal(recipientSelectLostStoredValue(liteOptionsWithoutBeznal, "", null), false);
assert.equal(recipientSelectLostStoredValue(liteOptionsWithoutBeznal, "Дима", null), false);

assert.equal(recoverLostRecipientFormValue(null, "Безнал", liteOptionsWithoutBeznal), "Безнал");
assert.equal(recoverLostRecipientFormValue("", "Касса", liteOptionsWithoutBeznal), "Касса");
assert.equal(recoverLostRecipientFormValue(null, "Безнал", fullOptions), null);
assert.equal(recoverLostRecipientFormValue("Дима", "Безнал", liteOptionsWithoutBeznal), "Дима");

const snapLost = overlayHistorySnapshotWithParticipants(
  { client: "Гарик", remaining_to: null, prepayment_to: "" },
  { remaining_to: "Безнал", prepayment_to: "Дима" },
);
assert.equal(snapLost.remaining_to, "Безнал");
assert.equal(snapLost.prepayment_to, "Дима");
assert.equal(snapLost.client, "Гарик");

const snapKept = overlayHistorySnapshotWithParticipants(
  { remaining_to: "Безнал" },
  { remaining_to: "Безнал" },
);
assert.equal(snapKept.remaining_to, "Безнал");

assert.equal(overlayHistorySnapshotWithParticipants(null, { remaining_to: "Безнал" }), null);

const recovered = recoverLostMoneyRecipientsInOrderData(
  { client: "ИП", remaining_to: null, prepayment_to: "" },
  { remaining_to: "Безнал", prepayment_to: "Касса", installer_payment_by: "" },
  {
    remaining_to: liteOptionsWithoutBeznal,
    prepayment_to: liteOptionsWithoutBeznal,
    installer_payment_by: ["", "Дима"],
  },
);
assert.equal(recovered.remaining_to, "Безнал");
assert.equal(recovered.prepayment_to, "Касса");
assert.equal(recovered.client, "ИП");

const intentionalClear = recoverLostMoneyRecipientsInOrderData(
  { remaining_to: null },
  { remaining_to: "Безнал" },
  { remaining_to: fullOptions },
);
assert.equal(intentionalClear.remaining_to, null);

// Сценарий 26.08 10:00 заказ 1193: форма потеряла «Безнал», в БД оно ещё было.
// После recover+overlay и история, и расчёт видят одно и то же «Безнал», без ложной смены.
const incidentForm = { client: "ИП Матевосян Грайр Андраники", remaining_to: null };
const incidentParticipants = { remaining_to: "Безнал", prepayment_to: "", installer_payment_by: "" };
const incidentRecovered = recoverLostMoneyRecipientsInOrderData(incidentForm, incidentParticipants, {
  remaining_to: liteOptionsWithoutBeznal,
  prepayment_to: liteOptionsWithoutBeznal,
  installer_payment_by: [""],
});
const incidentPrev = overlayHistorySnapshotWithParticipants(
  { client: "Гарик/ИП Матевосян", remaining_to: null },
  incidentParticipants,
);
assert.equal(incidentRecovered.remaining_to, "Безнал");
assert.equal(incidentPrev.remaining_to, "Безнал");
assert.equal(String(incidentRecovered.remaining_to || "").trim(), String(incidentPrev.remaining_to || "").trim());

assert.equal(shouldLockKassaBeznalRecipientSelect("Безнал", false), true);
assert.equal(shouldLockKassaBeznalRecipientSelect("Касса", false), true);
assert.equal(shouldLockKassaBeznalRecipientSelect("Дима", false), false);
assert.equal(shouldLockKassaBeznalRecipientSelect("Безнал", true), false);
assert.equal(shouldLockKassaBeznalRecipientSelect("", false), false);

assert.equal(preserveLockedKassaBeznalRecipient(null, "Безнал", false), "Безнал");
assert.equal(preserveLockedKassaBeznalRecipient("Дима", "Касса", false), "Касса");
assert.equal(preserveLockedKassaBeznalRecipient(null, "Безнал", true), null);
assert.equal(preserveLockedKassaBeznalRecipient("Дима", "Дима", false), "Дима");

const liteCannotClear = recoverLostMoneyRecipientsInOrderData(
  { remaining_to: null },
  { remaining_to: "Безнал" },
  { remaining_to: fullOptions },
  { canSelectRestricted: false },
);
assert.equal(liteCannotClear.remaining_to, "Безнал");

const adminCanClear = recoverLostMoneyRecipientsInOrderData(
  { remaining_to: null },
  { remaining_to: "Безнал" },
  { remaining_to: fullOptions },
  { canSelectRestricted: true },
);
assert.equal(adminCanClear.remaining_to, null);

console.log("test-order-money-recipients: ok");
