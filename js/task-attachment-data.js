/** Persist only attachment metadata; never object URLs, files or signed URLs. */
export function normalizeTaskAttachments(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    if (item.type === "order") {
      const orderId = Number(item.orderId);
      if (!Number.isSafeInteger(orderId) || orderId <= 0 || seen.has(`order:${orderId}`)) return [];
      seen.add(`order:${orderId}`);
      return [{ type: "order", orderId }];
    }
    if (item.type !== "photo" || typeof item.storagePath !== "string" || !item.storagePath.trim()) return [];
    const storagePath = item.storagePath.trim();
    if (seen.has(storagePath)) return [];
    seen.add(storagePath);
    return [{
      type: "photo",
      storagePath,
      thumbnailPath: typeof item.thumbnailPath === "string" ? item.thumbnailPath : null,
      mimeType: typeof item.mimeType === "string" ? item.mimeType : "image/jpeg",
      fileName: typeof item.fileName === "string" ? item.fileName : "Фото",
      fileSize: Number.isFinite(item.fileSize) ? item.fileSize : 0,
    }];
  });
}

export function taskOrderIdsFromBody(body) {
  return [...new Set([...String(body || "").matchAll(/\[\[order:(\d+)\]\]/g)]
    .map((match) => Number(match[1])).filter((id) => Number.isSafeInteger(id) && id > 0))];
}

export function taskAttachmentOrderIds(row) {
  return [...new Set([...taskOrderIdsFromBody(row?.body), ...normalizeTaskAttachments(row?.attachments)
    .filter((item) => item.type === "order").map((item) => item.orderId)])];
}

/** Every order the task belongs to: its source order plus orders inserted into the task. */
export function taskLinkedOrderIds(row) {
  const primaryOrderId = Number(row?.order_id);
  const ids = Number.isSafeInteger(primaryOrderId) && primaryOrderId > 0
    ? [primaryOrderId]
    : [];
  return [...new Set([...ids, ...taskAttachmentOrderIds(row)])];
}

export function taskReferencesOrder(row, orderId) {
  const id = Number(orderId);
  return Number.isSafeInteger(id) && id > 0 && taskLinkedOrderIds(row).includes(id);
}
