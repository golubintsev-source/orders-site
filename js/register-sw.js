(() => {
  if (!("serviceWorker" in navigator)) return;
  const me = document.currentScript;
  const explicit = me && me.getAttribute("data-sw");
  const swUrl =
    explicit ||
    (me && me.src ? new URL("../sw.js", me.src).href : new URL("/sw.js", window.location.origin).href);
  navigator.serviceWorker.register(swUrl).catch((e) => console.warn("[orders-site] SW register:", e));

  window.__pendingSwMessages = window.__pendingSwMessages || [];
  navigator.serviceWorker.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || (data.type !== "push-received" && data.type !== "open-chat")) return;
    window.dispatchEvent(new CustomEvent("orders-sw-message", { detail: data }));
    if (!window.__swMessageHandlerReady) {
      window.__pendingSwMessages.push(data);
    }
  });

  // Обновление не должно перезагружать PWA во время заполнения формы
  // или пока в памяти находятся ещё не сохранённые изменения.
  // Новый SW активируется штатно, свежая оболочка — при следующем запуске.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    window.dispatchEvent(new CustomEvent("orders-sw-update-ready"));
  });
})();
