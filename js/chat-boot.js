/** Start the initial chat list or dialog read before loading the app modules. */
(() => {
  const SNAPSHOT_KEY = "orders_site_chat_list_snapshot_v1";
  /** Match DIALOG_INITIAL_MESSAGE_LIMIT in messages.js. */
  const DIALOG_LIMIT = 30;

  const SUPABASE_URL = window.__SUPABASE_URL__ || "https://yizwpogwabosuguakyzt.supabase.co";
  const SUPABASE_KEY =
    window.__SUPABASE_ANON_KEY__ || "sb_publishable_e1pJB18UsEV-o_M43ROi9w_4mS--LrF";

  const DM_COLUMNS =
    "id, sender_id, recipient_id, sender_email, recipient_email, body, created_at, read_at," +
    " delivered_at, deleted_at, attachment_storage_path";
  const DIALOG_COLUMNS =
    "reply_to_id, edited_at, attachment_thumbnail_path, attachment_mime_type, attachment_file_name," +
    " attachment_file_size, attachment_width, attachment_height";

  function getChatPeerFromUrl() {
    try {
      const raw = new URLSearchParams(window.location.search).get("chat");
      if (!raw) return null;
      const peer = String(raw).trim();
      if (!/^(?:group:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(peer)) {
        return null;
      }
      return peer;
    } catch {
      return null;
    }
  }

  function showDialogShellIfNeeded() {
    if (!getChatPeerFromUrl()) return;
    const listView = document.getElementById("messagesChatListView");
    const dialogView = document.getElementById("messagesDialogView");
    if (listView) listView.hidden = true;
    if (dialogView) dialogView.hidden = false;
    document.getElementById("section-messages")?.classList.add("messages-section--dialog");
  }

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

  function restQuery(session, table, params) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    return fetch(url, {
      signal: controller.signal,
      headers: {
        apikey: SUPABASE_KEY,
        authorization: `Bearer ${session.token}`,
        accept: "application/json",
      },
    })
      .then(async (res) => {
        if (!res.ok) {
          const error = await res.json().catch(() => ({ message: res.statusText }));
          return { rows: null, error };
        }
        return { rows: await res.json(), error: null };
      })
      .catch((error) => ({ rows: null, error }))
      .finally(() => clearTimeout(timeout));
  }

  function fetchDialog(session, peerId) {
    const group = peerId.startsWith("group:");
    const columns = group
      ? "id, chat_id, sender_id, sender_email, body, created_at, deleted_at, attachment_storage_path"
      : DM_COLUMNS;
    const params = new URLSearchParams({
      select: `${columns}, ${DIALOG_COLUMNS}`,
      order: "id.desc",
      deleted_at: "is.null",
      limit: String(DIALOG_LIMIT),
    });
    if (group) {
      params.set("chat_id", `eq.${peerId.slice("group:".length)}`);
    } else {
      const { uid } = session;
      params.set("or", `(and(sender_id.eq.${uid},recipient_id.eq.${peerId}),and(sender_id.eq.${peerId},recipient_id.eq.${uid}))`);
    }
    return restQuery(session, group ? "group_messages" : "user_messages", params).then((pack) =>
      pack.rows ? { rows: pack.rows.reverse(), error: null } : pack,
    );
  }

  function fetchSummary(session) {
    return restQuery(session, "rpc/get_chat_summary", new URLSearchParams({ p_badge_only: "false" }))
      .then(({ rows, error }) => ({ data: rows, error }));
  }

  /** Start fetching the chat module before main.js. */
  function preloadMessagesModule() {
    for (const href of [
      "./js/messages.js",
      "./js/messages-body.js",
      "./js/format.js",
      "./js/user-names.js",
    ]) {
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
    const status = document.getElementById("messagesChatListMessage");
    if (status) status.textContent = "";
  }

  if (!isMessagesRoute()) return;

  const peerId = getChatPeerFromUrl();
  preloadMessagesModule();
  const session = readSession();
  if (!session) {
    if (peerId) {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", showDialogShellIfNeeded, { once: true });
      } else {
        showDialogShellIfNeeded();
      }
    }
    return;
  }

  if (peerId) {
    window.__chatDialogPreviewBoot = { uid: session.uid, peerId, dialog: fetchDialog(session, peerId) };
  } else {
    window.__chatSummaryBoot = { uid: session.uid, summary: fetchSummary(session) };
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        if (peerId) showDialogShellIfNeeded();
        else paintSnapshot(session.uid);
      },
      { once: true },
    );
  } else if (peerId) {
    showDialogShellIfNeeded();
  } else {
    paintSnapshot(session.uid);
  }
})();

