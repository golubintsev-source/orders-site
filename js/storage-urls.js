import { supabaseClient } from "./config.js";

export function isCroppableImageFile(file) {
  if (!file?.type?.startsWith("image/")) return false;
  if (file.type === "image/svg+xml" || file.type === "image/gif") return false;
  return true;
}

const SIGNED_FILE_URL_TTL_SECONDS = 60 * 10;
const SIGNED_FILE_URL_CACHE_MS = 9 * 60 * 1000;
const SIGNED_FILE_URL_CACHE_MAX = 500;
const SIGNED_FILE_URL_FALLBACK_CONCURRENCY = 4;
/** @type {Map<string, { url: string, expiresAt: number }>} */
const signedFileUrlCache = new Map();

function readCachedSignedFileUrl(storagePath) {
  const cached = signedFileUrlCache.get(String(storagePath || ""));
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    signedFileUrlCache.delete(String(storagePath || ""));
    return null;
  }
  return cached.url;
}

function rememberSignedFileUrl(storagePath, url) {
  if (!storagePath || !url) return;
  signedFileUrlCache.delete(String(storagePath));
  while (signedFileUrlCache.size >= SIGNED_FILE_URL_CACHE_MAX) {
    const oldestKey = signedFileUrlCache.keys().next().value;
    if (oldestKey == null) break;
    signedFileUrlCache.delete(oldestKey);
  }
  signedFileUrlCache.set(String(storagePath), {
    url: String(url),
    expiresAt: Date.now() + SIGNED_FILE_URL_CACHE_MS,
  });
}

/**
 * Получить временные ссылки одним запросом и повторно использовать их до истечения TTL.
 * @returns {Promise<Map<string, string>>}
 */
export async function getSignedFileUrls(storagePaths) {
  const paths = [...new Set((storagePaths || []).map((path) => String(path || "").trim()).filter(Boolean))];
  const result = new Map();
  const missing = [];

  for (const path of paths) {
    const cached = readCachedSignedFileUrl(path);
    if (cached) result.set(path, cached);
    else missing.push(path);
  }
  if (!missing.length) return result;

  const bucket = supabaseClient.storage.from("order-files");
  const { data, error } = await bucket.createSignedUrls(missing, SIGNED_FILE_URL_TTL_SECONDS);
  if (!error) {
    for (const row of data || []) {
      const path = String(row?.path || "");
      const url = row?.signedUrl || row?.signedURL || null;
      if (!path || !url) continue;
      rememberSignedFileUrl(path, url);
      result.set(path, url);
    }
  } else {
    console.warn("Ошибка пакетного получения ссылок, используем одиночные запросы:", error);
  }

  const unresolved = missing.filter((path) => !result.has(path));
  if (unresolved.length) {
    let nextIndex = 0;
    const rows = [];
    const workers = Array.from(
      { length: Math.min(SIGNED_FILE_URL_FALLBACK_CONCURRENCY, unresolved.length) },
      async () => {
        while (nextIndex < unresolved.length) {
          const path = unresolved[nextIndex++];
          const { data: singleData, error: singleError } = await bucket.createSignedUrl(
            path,
            SIGNED_FILE_URL_TTL_SECONDS,
          );
          rows.push([path, singleError ? null : singleData?.signedUrl || null]);
        }
      },
    );
    await Promise.all(workers);
    for (const [path, url] of rows) {
      if (!url) continue;
      rememberSignedFileUrl(path, url);
      result.set(path, url);
    }
  }
  return result;
}

export async function getSignedFileUrl(storagePath) {
  if (!storagePath) return null;
  const urls = await getSignedFileUrls([storagePath]);
  const url = urls.get(String(storagePath)) || null;
  if (!url) console.error("Ошибка получения ссылки:", storagePath);
  return url;
}
