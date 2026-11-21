import { supabaseClient } from "./config.js";
import { cropImageAttachment } from "./files.js";

let originalFile = null;
let originalUrl = null;
let resultUrl = null;
let running = false;

const byId = (id) => document.getElementById(id);

function clearResult() {
  resultUrl = null;
  byId("editPhotoResult").hidden = true;
  byId("editPhotoGenerated").removeAttribute("src");
  byId("editPhotoDownload").removeAttribute("href");
}

function setError(message = "") {
  const el = byId("editPhotoError");
  el.textContent = message;
  el.hidden = !message;
}

function setPhoto(file) {
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  originalFile = file;
  originalUrl = file ? URL.createObjectURL(file) : null;
  byId("editPhotoOriginal").hidden = !file;
  byId("editPhotoUpload").hidden = !!file;
  if (file) byId("editPhotoPreview").src = originalUrl;
  else {
    byId("editPhotoPreview").removeAttribute("src");
    byId("editPhotoPrompt").value = "";
  }
  clearResult();
  setError();
}

async function fileToJpegDataUrl(file) {
  let bitmap;
  let objectUrl;
  if (typeof createImageBitmap === "function") {
    try { bitmap = await createImageBitmap(file); } catch { /* iOS HEIC fallback below */ }
  }
  if (!bitmap) {
    objectUrl = URL.createObjectURL(file);
    try {
      bitmap = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = objectUrl;
      });
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      throw error;
    }
  }
  try {
    let scale = Math.min(1, 1600 / Math.max(bitmap.width || bitmap.naturalWidth, bitmap.height || bitmap.naturalHeight));
    for (let attempt = 0; attempt < 5; attempt++) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round((bitmap.width || bitmap.naturalWidth) * scale));
      canvas.height = Math.max(1, Math.round((bitmap.height || bitmap.naturalHeight) * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("canvas_unavailable");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const image = canvas.toDataURL("image/jpeg", Math.max(0.65, 0.86 - attempt * 0.05));
      if (image.length < 2_800_000) return image;
      scale *= 0.7;
    }
    throw new Error("image_too_large");
  } finally {
    bitmap.close?.();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

async function generatePhoto() {
  const prompt = byId("editPhotoPrompt").value.trim();
  if (running || !originalFile) return;
  if (!prompt) {
    setError("Опишите, что необходимо изменить на фото.");
    byId("editPhotoPrompt").focus();
    return;
  }
  running = true;
  clearResult();
  setError();
  byId("editPhotoGenerate").disabled = true;
  byId("editPhotoRemove").disabled = true;
  byId("editPhotoProgress").hidden = false;
  try {
    const [{ data, error }, image] = await Promise.all([
      supabaseClient.auth.getSession(), fileToJpegDataUrl(originalFile),
    ]);
    if (error || !data?.session?.access_token) throw new Error("unauthorized");
    const response = await fetch("/api/voice-assistant?mode=image-edit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify({ image, prompt }),
    });
    if (!response.ok) throw new Error(`image_edit_${response.status}`);
    const payload = await response.json();
    if (!/^data:image\/jpeg;base64,/.test(payload.image || "")) throw new Error("invalid_image_response");
    resultUrl = payload.image;
    byId("editPhotoGenerated").src = resultUrl;
    byId("editPhotoDownload").href = resultUrl;
    byId("editPhotoResult").hidden = false;
  } catch (error) {
    console.error("Image edit:", error);
    setError("Сгенерировать не получилось, повторите попытку");
  } finally {
    running = false;
    byId("editPhotoGenerate").disabled = false;
    byId("editPhotoRemove").disabled = false;
    byId("editPhotoProgress").hidden = true;
  }
}

async function sharePhoto() {
  if (!resultUrl) return;
  try {
    const blob = await (await fetch(resultUrl)).blob();
    const file = new File([blob], "izmenennoe-foto.jpg", { type: "image/jpeg" });
    if (!navigator.share || (navigator.canShare && !navigator.canShare({ files: [file] }))) {
      setError("Передача фото недоступна на этом устройстве. Скачайте фото и отправьте его через мессенджер.");
      return;
    }
    await navigator.share({ files: [file] });
  } catch (error) {
    if (error?.name !== "AbortError") setError("Не удалось отправить фото. Скачайте его и отправьте через мессенджер.");
  }
}

export function initEditPhotoSection() {
  const input = byId("editPhotoInput");
  byId("editPhotoUpload").addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
      setError("Выберите фотографию в формате JPEG, PNG, WebP или HEIC.");
      return;
    }
    const cropped = await cropImageAttachment(file);
    if (cropped) setPhoto(cropped);
  });
  byId("editPhotoRemove").addEventListener("click", () => setPhoto(null));
  byId("editPhotoPrompt").addEventListener("input", () => { clearResult(); setError(); });
  byId("editPhotoGenerate").addEventListener("click", generatePhoto);
  byId("editPhotoShare").addEventListener("click", sharePhoto);
}
