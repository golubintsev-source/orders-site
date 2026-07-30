/**
 * Ленивая подгрузка тяжёлых CDN-библиотек (Excel, карта, обрезка фото).
 * Не блокирует первый показ страницы «Заказы».
 */

const scriptPromises = new Map();
const stylePromises = new Map();

export const CDN = {
  loadImage: "https://cdn.jsdelivr.net/npm/blueimp-load-image@5.16.0/js/load-image.all.min.js",
  cropperJs: "https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.min.js",
  cropperCss: "https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.min.css",
  xlsx: "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js",
  html2canvas: "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js",
  exceljs: "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js",
  leafletJs: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js",
  leafletCss: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css",
};

export function loadStylesheet(href) {
  if (typeof document === "undefined") return Promise.resolve();
  if (stylePromises.has(href)) return stylePromises.get(href);
  if (document.querySelector(`link[data-lazy-cdn-loaded="${href}"]`)) {
    return Promise.resolve();
  }

  const p = new Promise((resolve, reject) => {
    const existing = document.querySelector(`link[data-lazy-cdn="${href}"]`) || document.querySelector(`link[href="${href}"]`);
    if (existing) {
      if (existing.dataset.lazyCdnLoaded === "1") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Не удалось загрузить CSS: ${href}`)), {
        once: true,
      });
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.crossOrigin = "anonymous";
    link.dataset.lazyCdn = href;
    link.onload = () => {
      link.dataset.lazyCdnLoaded = "1";
      resolve();
    };
    link.onerror = () => reject(new Error(`Не удалось загрузить CSS: ${href}`));
    document.head.appendChild(link);
  });
  stylePromises.set(href, p);
  return p;
}

export function loadScript(src) {
  if (typeof document === "undefined") return Promise.resolve();
  if (scriptPromises.has(src)) return scriptPromises.get(src);

  const p = new Promise((resolve, reject) => {
    const existing =
      document.querySelector(`script[data-lazy-cdn="${src}"]`) || document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.lazyCdnLoaded === "1") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => {
        existing.dataset.lazyCdnLoaded = "1";
        resolve();
      }, { once: true });
      existing.addEventListener("error", () => reject(new Error(`Не удалось загрузить скрипт: ${src}`)), {
        once: true,
      });
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.crossOrigin = "anonymous";
    s.dataset.lazyCdn = src;
    s.onload = () => {
      s.dataset.lazyCdnLoaded = "1";
      resolve();
    };
    s.onerror = () => reject(new Error(`Не удалось загрузить скрипт: ${src}`));
    document.head.appendChild(s);
  });
  scriptPromises.set(src, p);
  return p;
}

export async function ensureXlsx() {
  if (globalThis.XLSX) return globalThis.XLSX;
  await loadScript(CDN.xlsx);
  if (!globalThis.XLSX) throw new Error("XLSX не загрузился");
  return globalThis.XLSX;
}

export async function ensureExcelJs() {
  const existing = globalThis.ExcelJS ?? globalThis.exceljs?.default ?? globalThis.exceljs;
  if (existing) return existing;
  await loadScript(CDN.exceljs);
  const ExcelJS = globalThis.ExcelJS ?? globalThis.exceljs?.default ?? globalThis.exceljs;
  if (!ExcelJS) throw new Error("ExcelJS не загрузился");
  return ExcelJS;
}

export async function ensureHtml2Canvas() {
  if (globalThis.html2canvas) return globalThis.html2canvas;
  await loadScript(CDN.html2canvas);
  if (!globalThis.html2canvas) throw new Error("html2canvas не загрузился");
  return globalThis.html2canvas;
}

export async function ensureLeaflet() {
  if (!globalThis.L) {
    await loadStylesheet(CDN.leafletCss);
    await loadScript(CDN.leafletJs);
  }
  if (!globalThis.L) throw new Error("Leaflet не загрузился");
  return globalThis.L;
}

export async function ensureCropperLibs() {
  await Promise.all([loadStylesheet(CDN.cropperCss), loadScript(CDN.loadImage), loadScript(CDN.cropperJs)]);
  if (typeof globalThis.Cropper === "undefined") {
    throw new Error("Cropper не загрузился");
  }
}
