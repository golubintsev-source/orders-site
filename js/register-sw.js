(() => {
  if (!("serviceWorker" in navigator)) return;
  const me = document.currentScript;
  const explicit = me && me.getAttribute("data-sw");
  const swUrl =
    explicit ||
    (me && me.src ? new URL("../sw.js", me.src).href : new URL("/sw.js", window.location.origin).href);
  navigator.serviceWorker.register(swUrl).catch((e) => console.warn("[orders-site] SW register:", e));
})();
