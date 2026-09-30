export const DEFAULT_ORDERS_ADDRESS_COLUMN_WIDTH = 100;
export const MIN_ORDERS_ADDRESS_COLUMN_WIDTH = 80;
export const MAX_ORDERS_ADDRESS_COLUMN_WIDTH = 600;

export function normalizeOrdersAddressColumnWidth(value) {
  if (value == null || String(value).trim() === "") return null;
  const width = Number(value);
  if (!Number.isFinite(width)) return null;
  const rounded = Math.round(width);
  if (
    rounded < MIN_ORDERS_ADDRESS_COLUMN_WIDTH ||
    rounded > MAX_ORDERS_ADDRESS_COLUMN_WIDTH
  ) {
    return null;
  }
  return rounded;
}

export function resolveOrdersAddressColumnWidth(localValue, metadataValue) {
  return (
    normalizeOrdersAddressColumnWidth(localValue) ??
    normalizeOrdersAddressColumnWidth(metadataValue) ??
    DEFAULT_ORDERS_ADDRESS_COLUMN_WIDTH
  );
}
