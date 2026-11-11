/* Small, dependency-free boot screen. Runs before the application module graph. */
(() => {
  "use strict";
  const screen = document.getElementById("startupScreen");
  if (!screen) return;
  const root = document.documentElement;
  const title = document.getElementById("startupTitle");
  const description = document.getElementById("startupDescription");
  const picture = document.getElementById("startupPicture");
  const motion = document.getElementById("startupMotion");
  const phrase = document.getElementById("startupPhrase");
  const retry = document.getElementById("startupRetry");
  const progress = document.getElementById("startupProgress");
  const phrases = [
    "Открываем окна. Сквозняк в комплект не входит.",
    "Семь раз загрузим, один раз покажем.",
    "Данные на подходе. Уже снимают бахилы.",
    "Не давите на экран. Это не монтажная пена.",
    "Всё под контролем. Рулетка у начальника.",
    "Заказы едут. На каждом светофоре — красный.",
    "Протираем таблицы до прозрачности.",
    "Проверяем размеры. На глаз — только улыбаемся.",
    "Ещё немного — и всё будет в раме.",
    "Уплотняем данные. Чтобы ничего не продуло.",
    "Заказы найдены. Теперь ищем, кто взял ручку.",
    "Сервер задумался. Видимо, считает откосы.",
    "Монтажная пена сохнет быстрее, если на неё не смотреть.",
    "Ваши заказы проходят фейс-контроль у мастера.",
    "Окно в работу открывается. Москитку сняли.",
    "Сейчас всё появится. Это не обещание поставщика.",
    "Данные застряли в режиме проветривания.",
    "Собираем цифры. Саморезов осталось лишних всего два.",
    "Менеджер сказал: «Секундочку». Засекаем.",
    "Главное — не закрыть окно, пока открываем окна.",
  ];

  // Observe only the selected screen's data, never badges, telemetry, photos or writes.
  const tablesBySection = {
    all: ["orders"], new: ["orders", "app_settings"],
    calculations: ["calculations", "orders"],
    "all-salaries": ["calculations", "orders", "app_settings"],
    excess: ["excesses"], "tasks-all": ["order_tasks"], "order-tasks": ["order_tasks"],
    "changes-all": ["order_history", "excess_history", "excesses", "settings_history", "calculation_history", "task_history"],
    balance: ["calculations", "app_settings"],
    "manager-salary": ["orders", "app_settings"],
    "route-sheet": ["orders", "app_settings"], debts: ["orders"],
    "contractor-checks": ["contractor_checks"],
    statistics: ["site_access_logs"], "statistics-balance": ["site_access_logs"],
    settings: ["app_settings"], messages: ["user_messages", "group_chats", "group_messages"],
  };
  let tables = new Set(["profiles"]);
  const failures = new Set();
  let done = false;
  let diagnosis = 0;
  let checking = null;
  let lastHttpAt = -Infinity;
  let phase = "loading";
  let phraseIndex = Math.floor(Math.random() * phrases.length);
  phrase.hidden = false;
  phrase.textContent = phrases[phraseIndex];
  const phraseInterval = setInterval(() => {
    phraseIndex = (phraseIndex + 1) % phrases.length;
    phrase.textContent = phrases[phraseIndex];
  }, 5000);
  const deadline = setTimeout(() => void fail(), 30000);

  function stopTimers() {
    clearInterval(phraseInterval);
    clearTimeout(deadline);
  }

  function stopMotion() {
    if (!motion?.hasAttribute("src")) return;
    motion.classList.remove("is-playing");
    motion.removeAttribute("src");
    motion.load();
  }

  // Main CSS downloads without blocking the first paint. Do not reveal an unstyled app.
  const styles = document.getElementById("appStyles");
  const stylesReady = new Promise((resolve) => {
    if (!styles || styles.sheet) {
      if (styles) styles.media = "all";
      resolve(true);
      return;
    }
    styles.addEventListener("load", () => { styles.media = "all"; resolve(true); }, { once: true });
    styles.addEventListener("error", () => { resolve(false); void fail(); }, { once: true });
  });

  async function pingInternet(signal) {
    // no-cors accepts ya.ru's opaque response; checking response.ok would always fail.
    try {
      await fetch(`https://ya.ru/?orders_connection_check=${Date.now()}`, {
        mode: "no-cors", cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal,
      });
      return true;
    } catch {
      return false;
    }
  }

  function showError(online) {
    phase = online ? "data-error" : "offline";
    root.setAttribute("data-startup", phase);
    picture.src = `/img/startup/worker-${phase}.webp`;
    picture.alt = online ? "Грустный мастер у закрытого окна с табличкой «Перерыв»" : "Мастер ищет интернет с роутером в руке";
    title.textContent = online ? "Данные не загрузились" : "Нет подключения к интернету";
    title.hidden = false;
    description.hidden = false;
    description.textContent = online
      ? "Связь есть, но система пока не смогла получить данные. Попробуем ещё раз?"
      : "Проверьте Wi-Fi, мобильную сеть или VPN и попробуйте снова.";
    progress.hidden = true;
    phrase.hidden = true;
    retry.hidden = false;
  }

  async function fail() {
    if (done || checking || phase !== "loading") return;
    const id = ++diagnosis;
    stopTimers();
    stopMotion();
    phase = "checking";
    title.hidden = false;
    description.hidden = false;
    title.textContent = "Проверяем соединение…";
    description.textContent = "Выясняем, где задержались данные.";
    phrase.hidden = true;
    const controller = new AbortController();
    checking = controller;
    // Promise.race also bounds a fetch implementation that ignores AbortSignal.
    let timer;
    const expired = new Promise((resolve) => {
      timer = setTimeout(() => { controller.abort(); resolve(false); }, 4000);
    });
    const online = await Promise.race([pingInternet(controller.signal), expired]);
    clearTimeout(timer);
    if (checking === controller) checking = null;
    if (done || id !== diagnosis) return;
    // A fresh server response proves connectivity even when ya.ru is blocked by VPN.
    showError(online || (navigator.onLine !== false && Date.now() - lastHttpAt < 5000));
  }

  let releaseReady;
  const ready = new Promise((resolve) => { releaseReady = resolve; });
  window.__appStartup = {
    ready,
    get pending() { return !done; },
    expectSection(section) {
      tables = new Set(["profiles", ...(tablesBySection[section] || [])]);
    },
    async trackRead(input, init = {}, run) {
      if (done) return run();
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      const table = url.pathname.match(/\/rest\/v1\/([^/]+)$/)?.[1];
      const method = (init.method || input.method || "GET").toUpperCase();
      // The role lookup is mandatory; a background profiles directory is optional.
      const role = table === "profiles" && url.searchParams.get("select") === "role";
      if (method !== "GET" || !(role || (table !== "profiles" && tables.has(table)))) return run();
      // Legacy-column fallbacks can change SELECT, but must recover the same filters/page.
      url.searchParams.delete("select");
      url.searchParams.sort();
      const range = new Headers(init.headers || input.headers).get("range") || "";
      const key = `${url.href}|${range}`;
      try {
        const response = await run();
        if (done) return response;
        lastHttpAt = Date.now();
        if (response.ok) failures.delete(key);
        else failures.add(key);
        return response;
      } catch (error) {
        if (!done) failures.add(key);
        throw error;
      }
    },
    async complete() {
      if (done) return true;
      if (!(await stylesReady) || failures.size) { void fail(); return false; }
      done = true;
      diagnosis++;
      checking?.abort();
      stopTimers();
      stopMotion();
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("error", onResourceError, true);
      root.removeAttribute("data-startup");
      screen.hidden = true;
      const app = document.getElementById("appContainer");
      if (app) { app.inert = false; app.removeAttribute("aria-busy"); }
      window.dispatchEvent(new Event("resize"));
      releaseReady();
      return true;
    },
    fail,
  };

  retry.addEventListener("click", () => {
    if (retry.disabled) return;
    retry.disabled = true;
    retry.textContent = "Пробуем…";
    // A fresh document cancels old loads, polling and failed module imports as well.
    window.location.reload();
  });
  function onOffline() { void fail(); }
  function onResourceError(event) {
    if (event.target?.tagName === "SCRIPT") void fail();
  }
  window.addEventListener("offline", onOffline);
  window.addEventListener("error", onResourceError, true);
  if (navigator.onLine === false) void fail();
  if (phase === "loading" && motion && window.matchMedia?.("(prefers-reduced-motion: no-preference)").matches) {
    motion.addEventListener("playing", () => motion.classList.add("is-playing"), { once: true });
    motion.addEventListener("error", stopMotion, { once: true });
    motion.src = motion.dataset.src;
    motion.play().catch(stopMotion);
  }
})();
