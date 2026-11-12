import { supabaseClient } from "./config.js";

export const ORDER_PHOTO_VALIDATION_KEY = "order_photo_validation_enabled";

const resultCache = new WeakMap();
const MAX_ANALYSIS_DIMENSION = 1024;

export function isImageAttachment(file) {
  if (String(file?.type || "").toLowerCase().startsWith("image/")) return true;
  return /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i.test(String(file?.name || ""));
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(objectUrl);
    image.onload = () => { cleanup(); resolve(image); };
    image.onerror = () => { cleanup(); reject(new Error("Не удалось прочитать изображение")); };
    image.src = objectUrl;
  });
}

async function makeAnalysisDataUrl(file) {
  const image = await loadImage(file);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) throw new Error("Изображение пустое");
  const scale = Math.min(1, MAX_ANALYSIS_DIMENSION / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Не удалось подготовить изображение к проверке");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

async function runValidation(file) {
  const { data, error } = await supabaseClient.auth.getSession();
  const token = data?.session?.access_token;
  if (error || !token) throw new Error("Не удалось подтвердить авторизацию для проверки фото");

  const imageDataUrl = await makeAnalysisDataUrl(file);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let response;
  try {
    response = await fetch("/api/voice-assistant?mode=photo-validation", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ imageDataUrl, fileName: file.name || "photo.jpg" }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Проверка фото заняла слишком много времени. Повторите попытку");
    throw new Error("Не удалось проверить фото. Проверьте интернет и повторите попытку");
  } finally {
    clearTimeout(timer);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || "Не удалось проверить фото. Повторите попытку");
  if (!payload?.allowed) throw new Error(payload?.reason || "Это изображение нельзя прикрепить к заказу");
  return payload;
}

export async function validateOrderPhoto(file, onChecking) {
  if (!isImageAttachment(file)) return { allowed: true, category: "not_image" };

  const { data, error } = await supabaseClient.from("app_settings")
    .select("value")
    .eq("key", ORDER_PHOTO_VALIDATION_KEY)
    .maybeSingle();
  if (error) throw new Error("Не удалось загрузить настройку проверки фото. Повторите попытку");
  if (data?.value === "false") return { allowed: true, category: "validation_disabled" };

  let promise = resultCache.get(file);
  if (!promise) {
    onChecking?.();
    promise = runValidation(file).then((result) => {
      if (result.category === "validation_disabled") resultCache.delete(file);
      return result;
    }).catch((error) => { resultCache.delete(file); throw error; });
    resultCache.set(file, promise);
  }
  return promise;
}
