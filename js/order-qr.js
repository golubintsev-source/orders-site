import { buildOrderViewUrl } from "./app-routes.js";

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
export function showOrderViewQr(orderId) {
  const wrap = getWrap();
  const canvas = getCanvas();
  if (!wrap || !canvas) return;

  const url = buildOrderViewUrl(orderId);
  const QRCode = typeof window !== "undefined" ? window.QRCode : null;
  if (!QRCode?.toCanvas) {
    console.warn("QRCode library is not loaded");
    wrap.hidden = true;
    return;
  }

  QRCode.toCanvas(
    canvas,
    url,
    {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 160,
      color: { dark: "#111111", light: "#ffffff" },
    },
    (err) => {
      if (err) {
        console.error("QR generate error:", err);
        wrap.hidden = true;
        return;
      }
      wrap.hidden = false;
    }
  );
}
