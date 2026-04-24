/**
 * Скачивание .xlsx с диска без открытия во встроенном просмотрщике (Яндекс.Браузер и др.):
 * для blob с типом таблицы браузер подменяет загрузку на «открыть документ».
 *
 * @param {ArrayBuffer | Uint8Array | ArrayBufferView} data
 * @param {string} filename имя файла, должно заканчиваться на .xlsx
 */
export function downloadXlsxBuffer(data, filename) {
  const blob = new Blob([data], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.setAttribute("download", filename);
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
