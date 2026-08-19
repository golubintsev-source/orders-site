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
   * Перезагружаем её сами, но только пока пользователь ничего не начал делать —
   * иначе перезагрузка оборвёт набор сообщения или заполнение формы.
   */
  const GRACE_MS = 12_000;
  const startedAt = Date.now();
  let interacted = false;
  const markInteracted = () => {
    interacted = true;
  };
  for (const type of ["pointerdown", "keydown", "touchstart", "wheel"]) {
    window.addEventListener(type, markInteracted, { once: true, passive: true, capture: true });
  }

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
    if (reloading || interacted || Date.now() - startedAt > GRACE_MS) return;
    if (!(await consumeShellUpdated(worker))) return;
    if (reloading || interacted) return;
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
