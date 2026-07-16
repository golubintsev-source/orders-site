import { buildOrderViewUrl } from "./app-routes.js";

let qrcodeLoadPromise = null;

function loadQRCodeLib() {
  if (!qrcodeLoadPromise) {
    qrcodeLoadPromise = import("https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm").catch((err) => {
      qrcodeLoadPromise = null;
      throw err;
    });
  }
  return qrcodeLoadPromise;
}

function getWrap() {
  return document.getElementById("orderViewQrWrap");
}

function getCanvas() {
  return document.getElementById("orderViewQrCanvas");
}

export function hideOrderViewQr() {
  const wrap = getWrap();
  if (wrap) wrap.hidden = true;
  const canvas = getCanvas();
  if (canvas) {
    const ctx = canvas.getContext?.("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

/** Показать QR со ссылкой на просмотр заказа. */
export async function showOrderViewQr(orderId) {
  const wrap = getWrap();
  const canvas = getCanvas();
  if (!wrap || !canvas) return;

  const url = buildOrderViewUrl(orderId);

  try {
    const mod = await loadQRCodeLib();
    const toCanvas = mod.default?.toCanvas ?? mod.toCanvas;
    if (!toCanvas) {
      console.warn("QRCode.toCanvas is not available");
      wrap.hidden = true;
      return;
    }

    await new Promise((resolve, reject) => {
      toCanvas(
        canvas,
        url,
        {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 160,
          color: { dark: "#111111", light: "#ffffff" },
        },
        (err) => (err ? reject(err) : resolve())
      );
    });
    wrap.hidden = false;
  } catch (err) {
    console.error("QR generate error:", err);
    wrap.hidden = true;
  }
}
