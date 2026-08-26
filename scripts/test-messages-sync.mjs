import {
  timestampMs,
  isTimestampAfter,
  isTimestampSameOrBefore,
  laterIsoTimestamp,
  conversationPeerFromPushData,
  shouldSuppressPushNotification,
  shouldResetDialogFeed,
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

console.log("test-messages-sync: ok");
