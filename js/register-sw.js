(() => {
  if (!("serviceWorker" in navigator)) return;
  const me = document.currentScript;
  const explicit = me && me.getAttribute("data-sw");
  const swUrl =
    explicit ||
    (me && me.src ? new URL("../sw.js", me.src).href : new URL("/sw.js", window.location.origin).href);
  navigator.serviceWorker.register(swUrl).catch((e) => console.warn("[orders-site] SW register:", e));

  /**
   * Оболочка отдаётся из кэша, поэтому сразу после выкатки открывается прошлая версия.
   * После критичных фиксов (сохранение заказа) перезагружаем сразу, иначе в памяти
   * остаётся старый JS с upsert ON CONFLICT.
   */

  /** Запрос гасит флаг в service worker, поэтому «да» получит ровно один вызов. */
  function consumeShellUpdated(worker) {
    if (!worker) return Promise.resolve(false);
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => resolve(false), 2000);
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        resolve(Boolean(event.data?.updated));
      };
      worker.postMessage({ type: "get-shell-updated" }, [channel.port2]);
    });
  }

  let reloading = false;
  async function reloadIfShellUpdated(worker) {
    if (reloading) return;
    if (!(await consumeShellUpdated(worker))) return;
    if (reloading) return;
    reloading = true;
    window.location.reload();
  }

  // Фоновая проверка версии часто заканчивается раньше, чем страница успевает
  // подписаться на сообщения, поэтому спрашиваем и сами при старте.
  navigator.serviceWorker.ready.then((registration) => {
    void reloadIfShellUpdated(registration.active);
  });
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type !== "shell-updated") return;
    void reloadIfShellUpdated(navigator.serviceWorker.controller);
  });
})();
