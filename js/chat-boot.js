/**
 * Ранний старт раздела «Чаты» (обычный script в <head>, до модулей).
 *
 * Раньше первый запрос списка чатов уходил только после того, как отработают
 * supabase-js, весь граф main.js и await profile/settings — на iPhone это
 * несколько секунд белого экрана. Здесь запросы стартуют прямо во время
 * разбора HTML, через голый fetch к PostgREST (клиент supabase-js не нужен),
 * а список сразу рисуется из снимка прошлой сессии.
 *
 * Результаты складываются в window.__chatBoot; messages.js их забирает
 * (см. takeChatBootPack), поэтому дублирующих запросов нет.
 */
(() => {
  const SNAPSHOT_KEY = "orders_site_chat_list_snapshot_v1";
  /** Должно совпадать с MESSAGES_FAST_LOAD_DAYS в messages.js. */
  const FAST_LOAD_DAYS = 3;
  /** Должно совпадать с CHAT_LIST_FAST_PREVIEW_LIMIT в messages.js. */
  const FAST_PREVIEW_LIMIT = 200;
  /** Больше — значит выборка обрезана и messages.js должен долистать сам. */
  const UNREAD_PROBE_LIMIT = 1001;

  const SUPABASE_URL = window.__SUPABASE_URL__ || "https://yizwpogwabosuguakyzt.supabase.co";
  const SUPABASE_KEY =
    window.__SUPABASE_ANON_KEY__ || "sb_publishable_e1pJB18UsEV-o_M43ROi9w_4mS--LrF";

  const DM_COLUMNS =
    "id, sender_id, recipient_id, sender_email, recipient_email, body, created_at, read_at," +
    " delivered_at, deleted_at, attachment_storage_path";
  const GROUP_COLUMNS = "id, name, created_by, member_ids, created_at, avatar_storage_path";

  /** Тот же разбор маршрута, что и в app-routes.js, но без импорта модуля. */
  function isMessagesRoute() {
    if (window.location.protocol === "file:") {
      return window.location.hash.replace(/^#/, "") === "messages";
    }
    let path = window.location.pathname.replace(/\/index\.html$/i, "") || "/";
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    if (path === "/messages") return true;
    const rootLike = path === "/" || path === "/all";
    return rootLike && window.location.hash.replace(/^#/, "") === "messages";
  }

  function projectRef() {
    try {
      return new URL(SUPABASE_URL).hostname.split(".")[0];
    } catch {
      return "";
    }
  }

  /** JWT из локального хранилища supabase-js: обычный JSON либо "base64-<...>". */
  function readSession() {
    const ref = projectRef();
    if (!ref) return null;
    let raw;
    try {
      raw = localStorage.getItem(`sb-${ref}-auth-token`);
    } catch {
      return null;
    }
    if (!raw) return null;

    let text = raw;
    if (text.startsWith("base64-")) {
      try {
        text = atob(text.slice("base64-".length));
      } catch {
        return null;
      }
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    // Старые версии клиента заворачивали сессию в { currentSession: {...} }.
    const session = parsed?.currentSession || parsed;
    const token = session?.access_token;
    if (!token) return null;

    const expiresAt = Number(session.expires_at || 0);
    // Просроченный токен — пусть обновит supabase-js, ранний запрос только упрётся в 401.
    if (expiresAt && expiresAt * 1000 <= Date.now()) return null;

    const uid = session.user?.id || subFromJwt(token);
    if (!uid) return null;
    return { token, uid };
  }

  function subFromJwt(token) {
    try {
      const payload = token.split(".")[1];
      if (!payload) return null;
      const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
      return JSON.parse(json)?.sub || null;
    } catch {
      return null;
    }
  }

  /** Начало суток N-1 дней назад — как getMessagesFastLoadSinceIso в messages.js. */
  function fastLoadSinceIso() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - Math.max(0, FAST_LOAD_DAYS - 1));
    return d.toISOString();
  }

  function restQuery(session, table, params) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`;
    return fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        authorization: `Bearer ${session.token}`,
        accept: "application/json",
      },
    })
      .then(async (res) => {
        if (!res.ok) return { rows: null, error: { status: res.status, message: await res.text() } };
        return { rows: await res.json(), error: null };
      })
      .catch((error) => ({ rows: null, error }));
  }

  function fetchRecentDms(session) {
    const params = new URLSearchParams();
    params.set("select", DM_COLUMNS);
    params.set("or", `(sender_id.eq.${session.uid},recipient_id.eq.${session.uid})`);
    params.set("created_at", `gte.${fastLoadSinceIso()}`);
    params.set("order", "created_at.desc");
    params.set("limit", String(FAST_PREVIEW_LIMIT));
    // messages.js ждёт хронологический порядок.
    return restQuery(session, "user_messages", params).then((pack) =>
      pack.rows ? { rows: pack.rows.reverse(), error: null } : pack,
    );
  }

  function fetchUnreadIncoming(session) {
    const params = new URLSearchParams();
    params.set("select", "sender_id, sender_email, deleted_at");
    params.set("recipient_id", `eq.${session.uid}`);
    params.set("read_at", "is.null");
    params.set("deleted_at", "is.null");
    params.set("order", "id.asc");
    params.set("limit", String(UNREAD_PROBE_LIMIT));
    return restQuery(session, "user_messages", params).then((pack) => {
      if (!pack.rows) return pack;
      if (pack.rows.length >= UNREAD_PROBE_LIMIT) {
        return { rows: null, error: { message: "unread truncated" } };
      }
      return pack;
    });
  }

  function fetchMyGroups(session) {
    const params = new URLSearchParams();
    params.set("select", GROUP_COLUMNS);
    params.set("member_ids", `cs.{${session.uid}}`);
    params.set("order", "created_at.desc");
    return restQuery(session, "group_chats", params);
  }

  /** Догрузку messages.js (164 КБ) начинаем во время разбора HTML, а не после main.js. */
  function preloadMessagesModule() {
    for (const href of ["./js/messages.js", "./js/format.js", "./js/user-names.js"]) {
      const link = document.createElement("link");
      link.rel = "modulepreload";
      link.href = href;
      document.head.appendChild(link);
    }
  }

  function paintSnapshot(uid) {
    let raw;
    try {
      raw = localStorage.getItem(SNAPSHOT_KEY);
    } catch {
      return;
    }
    if (!raw) return;

    let snap;
    try {
      snap = JSON.parse(raw);
    } catch {
      return;
    }
    if (!snap?.html || String(snap.uid) !== String(uid)) return;

    const list = document.getElementById("messagesChatList");
    if (!list || list.children.length > 0) return;
    list.innerHTML = snap.html;
    // Сигнатуру не выставляем: первый настоящий рендер обязан пройти и сверить DOM.
    list.dataset.chatListFromSnapshot = "1";
  }

  if (!isMessagesRoute()) return;

  const session = readSession();
  if (!session) return;

  window.__chatBoot = {
    uid: session.uid,
    dm: fetchRecentDms(session),
    unread: fetchUnreadIncoming(session),
    groups: fetchMyGroups(session),
  };

  preloadMessagesModule();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => paintSnapshot(session.uid), { once: true });
  } else {
    paintSnapshot(session.uid);
  }
})();
