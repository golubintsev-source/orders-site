import {
  timestampMs,
  isTimestampAfter,
  isTimestampSameOrBefore,
  laterIsoTimestamp,
  conversationPeerFromPushData,
  shouldSuppressPushNotification,
  shouldResetDialogFeed,
  mergePartialChatListPeerIds,
  resolvePushSuppression,
  notificationBodyWithCount,
  nextReconnectDelayMs,
  pollSinceIso,
  groupUnreadCutoffIso,
} from "../js/messages-sync-utils.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const z = "2026-08-26T07:06:00.123Z";
const offset = "2026-08-26T07:06:00.123+00:00";
const micros = "2026-08-26T07:06:00.123456+00:00";
const later = "2026-08-26T07:06:01.000Z";

assert(timestampMs(z) === timestampMs(offset), "Z and +00:00 must be equal");
assert(timestampMs(micros) === timestampMs(z), "microseconds must collapse to the same ms");
assert(!isTimestampAfter(micros, z), "same message must not count as unread vs last_read");
assert(isTimestampSameOrBefore(micros, z), "opened chat covers last visible message");
assert(isTimestampAfter(later, micros), "next message stays unread");
assert(laterIsoTimestamp(z, micros) === z, "laterIso keeps first on equal ms");
assert(laterIsoTimestamp(z, later) === later, "laterIso picks later");

assert(conversationPeerFromPushData({ peerId: "abc" }) === "abc", "peerId");
assert(conversationPeerFromPushData({ chatId: "g1" }) === "group:g1", "chatId");
assert(
  conversationPeerFromPushData({ url: "/messages?chat=group:g1" }) === "group:g1",
  "url chat",
);

assert(
  shouldSuppressPushNotification({
    clientVisible: true,
    viewingPeerId: "u1",
    incomingPeerId: "u1",
  }),
  "suppress when the same dialog is on screen",
);
assert(
  !shouldSuppressPushNotification({
    clientVisible: true,
    viewingPeerId: null,
    incomingPeerId: "u1",
  }),
  "do not suppress on chat list",
);
assert(
  !shouldSuppressPushNotification({
    clientVisible: false,
    viewingPeerId: "u1",
    incomingPeerId: "u1",
  }),
  "do not suppress when PWA is in background",
);
assert(
  !shouldSuppressPushNotification({
    clientVisible: true,
    viewingPeerId: "u1",
    incomingPeerId: "u1",
    stateAgeMs: 120_000,
  }),
  "ignore stale visibility heartbeat",
);
assert(
  !shouldSuppressPushNotification({
    clientVisible: true,
    viewingPeerId: "u1",
    incomingPeerId: "u1",
    hasLiveClient: false,
  }),
  "closed PWA must still get the notification",
);

{
  const now = 1_800_000_000_000;
  assert(
    resolvePushSuppression({
      incomingPeerId: "u1",
      clientStates: [{ visible: true, peerId: "u1", at: now - 500 }],
      now,
    }),
    "fresh answer from the open dialog suppresses the banner",
  );
  assert(
    !resolvePushSuppression({
      incomingPeerId: "u1",
      clientStates: [{ visible: true, peerId: "u1", at: now - 60_000 }],
      now,
    }),
    "frozen tab cannot answer, so the banner must be shown",
  );
  assert(
    !resolvePushSuppression({ incomingPeerId: "u1", clientStates: [], now }),
    "no live window means no suppression",
  );
  assert(
    !resolvePushSuppression({
      incomingPeerId: "u1",
      clientStates: [{ visible: true, peerId: "u2", at: now - 100 }],
      now,
    }),
    "another dialog on screen does not hide the banner",
  );
  assert(
    resolvePushSuppression({
      incomingPeerId: "group:g1",
      clientStates: [
        { visible: false, peerId: "group:g1", at: now - 100 },
        { visible: true, peerId: "group:g1", at: now - 100 },
      ],
      now,
    }),
    "any visible window viewing the chat is enough",
  );
}

assert(notificationBodyWithCount("Привет", 1) === "Привет", "single message keeps the plain body");
assert(
  notificationBodyWithCount("Привет", 2) === "Привет\nЕщё 1 сообщение",
  "second message adds a singular counter",
);
assert(
  notificationBodyWithCount("Привет", 4) === "Привет\nЕщё 3 сообщения",
  "few messages use the paucal form",
);
assert(
  notificationBodyWithCount("Привет", 8) === "Привет\nЕщё 7 сообщений",
  "many messages use the plural form",
);
assert(
  notificationBodyWithCount("Привет", 13) === "Привет\nЕщё 12 сообщений",
  "teens always use the plural form",
);

{
  const flat = nextReconnectDelayMs(0, { baseMs: 1_000, maxMs: 30_000 });
  assert(flat === 1_000, "first retry waits the base delay");
  assert(
    nextReconnectDelayMs(3, { baseMs: 1_000, maxMs: 30_000 }) === 8_000,
    "delay doubles with every attempt",
  );
  assert(
    nextReconnectDelayMs(20, { baseMs: 1_000, maxMs: 30_000 }) === 30_000,
    "delay never exceeds the cap",
  );
  for (let i = 0; i < 50; i += 1) {
    const jittered = nextReconnectDelayMs(2, { baseMs: 1_000, maxMs: 30_000, jitter: 0.5 });
    assert(jittered >= 3_000 && jittered <= 5_000, "jitter stays around the nominal delay");
  }
}

assert(pollSinceIso(null) === null, "empty feed has no catch-up window");
assert(
  pollSinceIso("2026-08-26T07:06:00.000Z", 60_000) === "2026-08-26T07:05:00.000Z",
  "catch-up window reaches back before the last seen message",
);
assert(
  timestampMs(pollSinceIso("2026-08-26T07:06:00.000Z", 0)) ===
    timestampMs("2026-08-26T07:06:00.000Z"),
  "zero overlap keeps the exact cutoff",
);

{
  const chatIds = ["a", "b"];
  const allRead = new Map([
    ["a", "2026-08-20T00:00:00.000Z"],
    ["b", "2026-08-25T00:00:00.000Z"],
  ]);
  assert(
    groupUnreadCutoffIso(chatIds, allRead) === "2026-08-20T00:00:00.000Z",
    "cutoff is the earliest read mark across chats",
  );
  assert(
    groupUnreadCutoffIso(chatIds, new Map([["b", "2026-08-25T00:00:00.000Z"]])) === null,
    "a never-opened chat disables the cutoff so its unread are not lost",
  );
  assert(groupUnreadCutoffIso([], allRead) === null, "no chats means no cutoff");
}

assert(shouldResetDialogFeed("user-a", "user-b"), "switching chats must reset the feed");
assert(!shouldResetDialogFeed("user-a", "user-a"), "reopening the same chat keeps the feed");
assert(shouldResetDialogFeed("", "user-b"), "empty painted peer is a switch");
assert(shouldResetDialogFeed(null, "user-b"), "missing painted peer is a switch");
assert(shouldResetDialogFeed("group:1", "group:2"), "switching groups must reset the feed");
assert(!shouldResetDialogFeed("group:1", "group:1"), "same group keeps the feed");

function canPaintDialog({ gen, loadGen, view, activePeer, paintedPeer, peerAtStart }) {
  return (
    gen === loadGen &&
    view === "dialog" &&
    String(activePeer || "") === String(peerAtStart || "") &&
    !shouldResetDialogFeed(paintedPeer, peerAtStart)
  );
}

assert(
  !canPaintDialog({
    gen: 1,
    loadGen: 2,
    view: "dialog",
    activePeer: "b",
    paintedPeer: "b",
    peerAtStart: "a",
  }),
  "stale load of previous chat must not paint after switch",
);
assert(
  !canPaintDialog({
    gen: 2,
    loadGen: 2,
    view: "list",
    activePeer: null,
    paintedPeer: "a",
    peerAtStart: "a",
  }),
  "paint must not run after leaving to the chat list",
);
assert(
  canPaintDialog({
    gen: 2,
    loadGen: 2,
    view: "dialog",
    activePeer: "b",
    paintedPeer: "b",
    peerAtStart: "b",
  }),
  "current dialog load may paint",
);

let paintedPeer = "a";
let html = "messages of A";
if (shouldResetDialogFeed(paintedPeer, "b")) {
  html = "Загрузка…";
  paintedPeer = "b";
}
assert(html === "Загрузка…", "feed must drop previous chat messages immediately");
assert(paintedPeer === "b", "feed peer must match the chat being opened");

{
  const feed = { innerHTML: "messages of A", dataset: { peerId: "a" } };
  let loadGen = 1;
  const staleGen = loadGen;
  const stalePeer = "a";
  await new Promise((resolve) => {
    setTimeout(() => {
      if (
        canPaintDialog({
          gen: staleGen,
          loadGen,
          view: "dialog",
          activePeer: "b",
          paintedPeer: feed.dataset.peerId,
          peerAtStart: stalePeer,
        })
      ) {
        feed.innerHTML = "STALE A";
      }
      resolve();
    }, 15);
    loadGen += 1;
    if (shouldResetDialogFeed(feed.dataset.peerId, "b")) {
      feed.innerHTML = "Загрузка…";
      feed.dataset.peerId = "b";
    }
  });
  assert(feed.innerHTML === "Загрузка…", "delayed previous-chat paint must not win");
  assert(feed.dataset.peerId === "b", "delayed paint must not restore previous peer");
}

{
  const recent = ["group:1", "dima", "andrey", "factory"];
  const onScreen = ["group:1", "dima", "andrey", "factory", "lena"];
  const merged = mergePartialChatListPeerIds(recent, onScreen);
  assert(merged.includes("lena"), "partial 3-day fetch must keep the older chat already on screen");
  assert(merged[merged.length - 1] === "lena", "retained older chat stays at the bottom");
  assert(merged.filter((id) => id === "dima").length === 1, "already-listed peers are not duplicated");
  assert(
    mergePartialChatListPeerIds(["a", "b"], []).join(",") === "a,b",
    "empty screen does not invent extra chats",
  );
  assert(
    mergePartialChatListPeerIds([], ["lena"]).join(",") === "lena",
    "snapshot-only chat survives an empty partial pass",
  );
}

console.log("test-messages-sync: ok");
