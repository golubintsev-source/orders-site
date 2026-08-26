/**
 * «Кому предоплата» / «Кому остаток»: форма и снимок для истории
 * могут потерять значение (select без option), а расчёты смотрят на поле из БД.
 */

export const MONEY_RECIPIENT_HISTORY_KEYS = ["prepayment_to", "remaining_to", "installer_payment_by"];

function trimRecipient(v) {
  return String(v ?? "").trim();
}

/**
 * Браузер сбрасывает value select, если option нет в списке.
 * Тогда форма пустая, а в БД ещё «Безнал»/«Касса» — это не сознательная смена.
 *
 * @param {string[]} optionValues
 * @param {unknown} storedValue значение из заказа / initialParticipants
 * @param {unknown} formValue значение из getFormData()
 */
export function recipientSelectLostStoredValue(optionValues, storedValue, formValue) {
  const stored = trimRecipient(storedValue);
  const form = trimRecipient(formValue);
  if (!stored || form) return false;
  const options = Array.isArray(optionValues) ? optionValues.map((v) => String(v ?? "")) : [];
  return !options.includes(stored) && !options.includes(String(storedValue ?? ""));
}

/**
 * Вернуть значение из БД, если select его потерял; иначе оставить formValue.
 * @returns {unknown}
 */
export function recoverLostRecipientFormValue(formValue, storedValue, optionValues) {
  if (recipientSelectLostStoredValue(optionValues, storedValue, formValue)) {
    return storedValue == null || storedValue === "" ? formValue : storedValue;
  }
  return formValue;
}

/**
 * Для истории: если форма обнулила получателя, а снимок participants ещё хранит
 * значение из БД — считать предыдущим значением то, что было в заказе.
 * @param {Record<string, unknown> | null | undefined} snapshot
 * @param {Record<string, unknown> | null | undefined} participants
 */
export function overlayHistorySnapshotWithParticipants(snapshot, participants) {
  if (!snapshot || !participants) return snapshot;
  const overlay = { ...snapshot };
  for (const key of MONEY_RECIPIENT_HISTORY_KEYS) {
    const form = overlay[key];
    const stored = participants[key];
    if (!trimRecipient(form) && trimRecipient(stored)) {
      overlay[key] = stored;
    }
  }
  return overlay;
}

/**
 * Применить recoverLostRecipientFormValue к полям получателей в данных сохранения.
 * @param {Record<string, unknown>} orderData
 * @param {Record<string, unknown> | null | undefined} participants
 * @param {Record<string, string[]>} optionValuesByKey ключ поля → значения option
 */
export function recoverLostMoneyRecipientsInOrderData(orderData, participants, optionValuesByKey) {
  if (!orderData || !participants) return orderData;
  const next = { ...orderData };
  for (const key of MONEY_RECIPIENT_HISTORY_KEYS) {
    const options = optionValuesByKey?.[key] || [];
    next[key] = recoverLostRecipientFormValue(next[key], participants[key], options);
  }
  return next;
}
