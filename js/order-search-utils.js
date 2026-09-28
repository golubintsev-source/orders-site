/** Нормализация поиска по значениям, которые отображаются в таблице заказов. */
function normalizeOrderSearchValue(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[\s\u00a0\u202f]+/g, " ");
}

/**
 * Вторая форма нужна для телефонов, денежных сумм и номера вида 1419_О:
 * запросы «89991234567», «100000» и «1419О» должны находить форматированный текст.
 */
function compactOrderSearchValue(value) {
  return normalizeOrderSearchValue(value).replace(/[\s_()+\-.,/\\]+/g, "");
}

export function orderSearchMatchesValues(values, query) {
  const normalizedQuery = normalizeOrderSearchValue(query);
  if (!normalizedQuery) return true;
  const compactQuery = compactOrderSearchValue(normalizedQuery);

  return (values || []).some((value) => {
    const normalizedValue = normalizeOrderSearchValue(value);
    if (normalizedValue.includes(normalizedQuery)) return true;
    return Boolean(compactQuery) && compactOrderSearchValue(normalizedValue).includes(compactQuery);
  });
}
