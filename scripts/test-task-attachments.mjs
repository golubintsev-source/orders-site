import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { normalizeTaskAttachments, taskAttachmentOrderIds } from "../js/task-attachment-data.js";

const normalize = (value) => JSON.parse(JSON.stringify(value));
assert.deepEqual(normalizeTaskAttachments(null), []);
assert.deepEqual(taskAttachmentOrderIds({ attachments: [
  { type: "order", orderId: "42" }, { type: "order", orderId: 42 },
  { type: "order", orderId: -1 }, { type: "order", orderId: "bad" },
]}), [42]);
assert.deepEqual(normalizeTaskAttachments([{ type: "photo" }, { type: "unknown" }]), []);
assert.deepEqual(normalizeTaskAttachments([{ type: "order", orderId: 2, signedUrl: "secret" }]), [
  { type: "order", orderId: 2 },
]);

function element() {
  return {
    hidden: true, dataset: {}, value: "", innerHTML: "", textContent: "", listeners: {},
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {},
    addEventListener(name, listener) { this.listeners[name] = listener; },
  };
}
const elements = new Map();
const document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  },
  addEventListener() {},
};
const state = { currentUser: { id: "user-id", email: "author@example.com" } };
const calls = [];
let failSecondUpload = true;
const persisted = [];
const stubs = {
  "./state.js": { state },
  "./roles.js": { isOrderHiddenForCurrentRole: () => false },
  "./format.js": { formatOrderIdTypeChip: (id) => `00${id}_О` },
  "./order-summary-cache.js": { getOrderSummary: () => ({ order_type: "Окна" }) },
  "./app-routes.js": { buildOrderViewUrl: (id) => `/?order=${id}` },
  "./storage-urls.js": {
    getSignedFileUrl: () => null, getSignedFileUrls: () => new Map(),
    isCroppableImageFile: () => true,
  },
  "./config.js": { supabaseClient: { from: () => ({ insert: async (payload) => {
    persisted.push(payload); return { error: null };
  } }) } },
  "./user-names.js": { displayNameByEmail: (email) => email },
  "./users-directory.js": { loadTaskExecutorPickerUsers: async () => [] },
  "./offline-cache.js": {
    addPendingOfflineTask() {}, nextOfflineTempTaskId: () => -1, isOfflineDataMode: () => false,
  },
  "./files.js": { uploadChatPhoto: async (file) => {
    calls.push(file.name);
    if (file.name === "second.jpg" && failSecondUpload) throw new Error("upload failed");
    return { storagePath: `user/messages/${file.name}`, fileName: file.name,
      previewUrl: "blob:must-not-persist", signedUrl: "must-not-persist" };
  } },
};
const context = vm.createContext({ document, console, URL: {
  createObjectURL: () => "blob:preview", revokeObjectURL() {},
} });
async function loadModule(path) {
  const mod = new vm.SourceTextModule(await readFile(new URL(`../js/${path}`, import.meta.url), "utf8"), {
    context,
    importModuleDynamically: async (specifier) => {
      const dependency = stub(specifier);
      await dependency.link(() => {});
      await dependency.evaluate();
      return dependency;
    },
  });
  await mod.link(async (specifier) => {
    if (specifier === "./task-attachment-data.js") return loadModule("task-attachment-data.js");
    return stub(specifier);
  });
  await mod.evaluate();
  return mod;
}
function stub(specifier) {
  assert.ok(stubs[specifier], `unexpected dependency ${specifier}`);
  const values = stubs[specifier];
  return new vm.SyntheticModule(Object.keys(values), function () {
    for (const [name, value] of Object.entries(values)) this.setExport(name, value);
  }, { context });
}

const attachments = (await loadModule("task-attachments.js")).namespace;
attachments.initTaskAttachments();
const gallery = document.getElementById("taskPhotoGalleryInput");
gallery.files = [{ type: "image/jpeg", name: '<img onerror="bad">.jpg' }, { type: "image/jpeg", name: "second.jpg" }];
gallery.listeners.change();
assert.equal(attachments.hasTaskDraftAttachments(), true);
assert.doesNotMatch(document.getElementById("taskPendingAttachments").innerHTML, /onerror="bad"/);
await assert.rejects(attachments.prepareTaskAttachments(), /upload failed/);
assert.equal(attachments.hasTaskDraftAttachments(), true, "failed uploads keep the draft");
failSecondUpload = false;
const savedAttachments = await attachments.prepareTaskAttachments();
assert.equal(calls.length, 3, "retry reuses the already uploaded first photo");
assert.equal(savedAttachments.length, 2);
assert.doesNotMatch(JSON.stringify(savedAttachments), /blob:|must-not-persist/);
attachments.setTaskAttachmentsBusy(true);
gallery.files = [{ type: "image/jpeg", name: "ignored.jpg" }];
gallery.listeners.change();
assert.equal((await attachments.prepareTaskAttachments()).length, 2, "busy draft ignores late file selections");
attachments.setTaskAttachmentsBusy(false);

const html = attachments.renderTaskAttachmentsHtml({ attachments: [
  { type: "order", orderId: 42 }, ...savedAttachments,
] });
assert.match(html, /my-tasks-order-link/);
assert.match(html, /data-order-id="42"/);
assert.match(html, /task-attached-photo/);
assert.doesNotMatch(html, /onerror="bad"/);

const shared = (await loadModule("task-form-shared.js")).namespace;
const result = await shared.insertTask({ body: "", executorEmails: ["worker@example.com"], attachments: savedAttachments });
assert.equal(result.error, null, "photo-only task can be saved");
assert.deepEqual(normalize(persisted[0].attachments), normalize(savedAttachments));
assert.equal(persisted[0].executor_emails[0], "worker@example.com");
assert.equal(persisted[0].author_login, "author@example.com");
await shared.insertTask({ body: "Order only", attachments: [{ type: "order", orderId: 42 }] });
assert.deepEqual(normalize(persisted[1].attachments), [{ type: "order", orderId: 42 }]);
await shared.insertTask({ body: "Text only" });
assert.equal("attachments" in persisted[2], false, "existing text-only callers remain compatible");
assert.ok((await shared.insertTask({ body: " " })).error);
state.currentUser = null;
assert.ok((await shared.insertTask({ body: "test", attachments: savedAttachments })).error);
attachments.clearTaskDraftAttachments();
assert.equal(attachments.hasTaskDraftAttachments(), false);
assert.equal(document.getElementById("taskPendingAttachments").hidden, true);

// Exercise the real submit handler: preserve drafts on failure, reject double submit,
// then reset only after the database has accepted the task.
const taskSource = await readFile(new URL("../js/tasks.js", import.meta.url), "utf8");
const createSource = taskSource.slice(taskSource.indexOf("export async function createOrderTask()"),
  taskSource.indexOf("\nexport { refreshMyTasksNavBadge }", taskSource.indexOf("export async function createOrderTask()")))
  .replace("export async function", "async function");
const input = document.getElementById("orderTaskTextInput");
input.value = "Keep this draft";
let releaseUpload;
let shouldFail = true;
let saveCalls = 0;
let cleared = false;
let formDisabled;
const submitContext = vm.createContext({
  document, state: { currentUser: { id: "user" } }, console: { error() {} },
  isTaskAttachmentsBusy: () => false, hasTaskDraftAttachments: () => true,
  getSelectedExecutorEmails: () => ["worker@example.com"], datetimeLocalToIso: () => null,
  isOfflineDataMode: () => false,
  setTaskFormDisabled: (value) => { formDisabled = value; }, setTaskAttachmentsBusy() {},
  prepareTaskAttachments: () => new Promise((resolve) => { releaseUpload = () => resolve(savedAttachments); }),
  insertTask: async () => { saveCalls++; return { error: shouldFail ? new Error("save failed") : null }; },
  resizeTaskTextInput() {}, clearTaskDraftAttachments: () => { cleared = true; },
  resetTaskFormDefaults() {}, loadAllTasks: async () => {}, loadOrderTasks: async () => {}, refreshMyTasksNavBadge() {},
});
vm.runInContext("let taskCreateInFlight = false;\n" + createSource, submitContext, {
  importModuleDynamically: async () => {
    const dependency = new vm.SyntheticModule(["refreshActiveTaskMessageRefs", "refreshActiveTaskOrderRefs"], function () {
      this.setExport("refreshActiveTaskMessageRefs", () => {});
      this.setExport("refreshActiveTaskOrderRefs", () => {});
    }, { context: submitContext });
    await dependency.link(() => {}); await dependency.evaluate(); return dependency;
  },
});
const first = submitContext.createOrderTask();
await submitContext.createOrderTask();
assert.equal(formDisabled, true);
releaseUpload(); await first;
assert.equal(saveCalls, 1, "double submission is ignored while uploading");
assert.equal(input.value, "Keep this draft");
assert.equal(cleared, false);
assert.equal(formDisabled, false);
shouldFail = false;
const retry = submitContext.createOrderTask();
releaseUpload(); await retry;
assert.equal(saveCalls, 2);
assert.equal(input.value, "");
assert.equal(cleared, true);
console.log("PASS: metadata validation, XSS escaping, upload retry, draft locking, photo/order persistence and reset");
