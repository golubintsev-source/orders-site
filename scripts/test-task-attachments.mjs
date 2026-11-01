import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import {
  normalizeTaskAttachments,
  taskAttachmentOrderIds,
  taskLinkedOrderIds,
  taskReferencesOrder,
} from "../js/task-attachment-data.js";

const normalize = (value) => JSON.parse(JSON.stringify(value));
assert.deepEqual(normalizeTaskAttachments(null), []);
assert.deepEqual(taskAttachmentOrderIds({ attachments: [
  { type: "order", orderId: "42" }, { type: "order", orderId: 42 },
  { type: "order", orderId: -1 }, { type: "order", orderId: "bad" },
]}), [42]);
assert.deepEqual(normalizeTaskAttachments([{ type: "photo" }, { type: "unknown" }]), []);
assert.deepEqual(taskLinkedOrderIds({
  order_id: 41,
  body: "Сверить [[order:42]] и [[order:43]]",
  attachments: [{ type: "order", orderId: 42 }, { type: "order", orderId: 44 }],
}), [41, 42, 43, 44]);
assert.equal(taskReferencesOrder({ body: "[[order:42]]" }, 42), true);
assert.equal(taskReferencesOrder({ attachments: [{ type: "order", orderId: 44 }] }, 44), true);
assert.equal(taskReferencesOrder({ order_id: 41 }, 42), false);
assert.deepEqual(normalizeTaskAttachments([{ type: "order", orderId: 2, signedUrl: "secret" }]), [
  { type: "order", orderId: 2 },
]);

function element() {
  return {
    hidden: true, dataset: {}, value: "", textContent: "", listeners: {}, attributes: {},
    _html: "", _items: [],
    get innerHTML() { return this._html; },
    set innerHTML(value) {
      this._html = value;
      this._items = [...value.matchAll(/<li[^>]*aria-selected="(true|false)"/g)].map((match) => {
        const item = element(); item.attributes["aria-selected"] = match[1]; return item;
      });
    },
    querySelectorAll(selector) { return selector === "li" ? this._items : []; },
    focus() {}, scrollIntoView() {},
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
    dispatchEvent(event) { this.listeners[event.type]?.(event); },
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return this.attributes[name]; },
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
const state = { currentUser: { id: "user-id", email: "author@example.com" }, allOrders: [
  { id: 42, client: "Иван" }, { id: 43, payment_status: "Заказ закрыт" },
  { id: 44, client: "Анна" }, { id: 45, hidden: true },
] };
const calls = [];
let failSecondUpload = true;
const persisted = [];
const stubs = {
  "./state.js": { state },
  "./roles.js": { isOrderHiddenForCurrentRole: (order) => order.hidden },
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
  "./orders-runtime.js": { ensureOrdersData: async () => ({
    buildOrderPickerRowHtml: (order) => `<div class="messages-suggestion-order-row">${order.id}</div>`,
  }) },
  "./files.js": { uploadChatPhoto: async (file) => {
    calls.push(file.name);
    if (file.name === "second.jpg" && failSecondUpload) throw new Error("upload failed");
    return { storagePath: `user/messages/${file.name}`, fileName: file.name,
      previewUrl: "blob:must-not-persist", signedUrl: "must-not-persist" };
  } },
};
const context = vm.createContext({ document, console, Event, MouseEvent: Event, setTimeout, clearTimeout, URL: {
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
const composer = document.getElementById("orderTaskTextInput");
composer.value = "До  после";
composer.setSelectionRange(3, 3);
document.getElementById("taskPickOrderBtn").listeners.click();
await new Promise((resolve) => setImmediate(resolve));
const list = document.getElementById("taskComposerSuggestions");
assert.equal(list.hidden, false, "the order menu opens inline suggestions");
assert.equal(list.querySelectorAll("li").length, 2, "menu shows open, permitted orders");
assert.match(list.innerHTML, /messages-suggestion-order-row/);
composer.listeners.keydown({ key: "ArrowDown", preventDefault() {} });
composer.listeners.keydown({ key: "Enter", preventDefault() {} });
assert.equal(composer.value, "До [[order:44]]  после", "selected order is inserted at the caret like messages");
assert.equal(list.hidden, true);
assert.deepEqual(normalize(await attachments.prepareTaskAttachments()), [{ type: "order", orderId: 44 }]);
assert.match(attachments.renderTaskBodyHtml(composer.value), /message-order-link/);
assert.doesNotMatch(attachments.renderTaskBodyHtml('<img onerror="bad"> [[order:42]]'), /<img/);
assert.deepEqual(taskAttachmentOrderIds({ body: "[[order:42]] [[order:44]]", attachments: [
  { type: "order", orderId: 42 }, { type: "order", orderId: 43 },
]}), [42, 44, 43], "inline references and previously saved attachments both remain readable");
assert.doesNotMatch(attachments.renderTaskAttachmentsHtml({ body: composer.value, attachments: [{type: "order", orderId: 44}] }), /data-order-id/, "inline orders are not rendered twice");
composer.value = "Нужно &4";
composer.setSelectionRange(composer.value.length, composer.value.length);
composer.listeners.input();
await new Promise((resolve) => setTimeout(resolve, 150));
assert.equal(list.hidden, false, "typing & opens order suggestions");
assert.equal(list.querySelectorAll("li").length, 3, "typed search also finds closed orders, as in messages");
list.querySelectorAll("li")[0].dispatchEvent(new Event("mousedown"));
assert.equal(composer.value, "Нужно [[order:42]] ", "typed &query is replaced with the selected token");
composer.value = "";
composer.setSelectionRange(0, 0);
composer.listeners.input();
assert.deepEqual(normalize(await attachments.prepareTaskAttachments()), [], "removing a token removes its attachment");
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

// Editing gets an independent draft, seeded with storage metadata. Existing photos
// need no upload; inline orders track the edited text and legacy orders survive.
const editElements = new Map();
const getEditElement = (id) => {
  if (!editElements.has(id)) editElements.set(id, element());
  return editElements.get(id);
};
getEditElement("orderTaskTextInput").value = "Текст [[order:42]]";
const originalAttachments = [{ type: "photo", storagePath: "saved/photo.jpg", fileName: "Снимок.jpg" },
  { type: "order", orderId: 42 }, { type: "order", orderId: 44 }];
const editor = attachments.createTaskAttachmentComposer({ getElement: getEditElement, initialAttachments: originalAttachments });
const uploadsBeforeEdit = calls.length;
assert.equal(editor.hasAttachments(), true);
editor.setBusy(true);
assert.match(getEditElement("taskPendingAttachments").innerHTML, /data-crop="0"/);
assert.match(getEditElement("taskPendingAttachments").innerHTML, /data-remove-photo="0"/);
const editedAttachments = normalize(await editor.prepare());
assert.equal(calls.length, uploadsBeforeEdit, "existing photos are not uploaded again");
assert.deepEqual(editedAttachments.filter((item) => item.type === "order"), [{ type: "order", orderId: 42 }, { type: "order", orderId: 44 }]);
assert.equal(editedAttachments.find((item) => item.type === "photo").storagePath, "saved/photo.jpg");
assert.equal(attachments.isTaskAttachmentsBusy(), false, "the create form remains independent");
getEditElement("orderTaskTextInput").value = "Без ссылки";
assert.deepEqual(normalize(await editor.prepare()).filter((item) => item.type === "order"), [{ type: "order", orderId: 44 }]);
editor.clear();
assert.equal(originalAttachments.length, 3, "discarding the editor draft does not mutate saved attachments");
assert.deepEqual(normalize(await editor.prepare()), []);
editor.dispose();
console.log("PASS: independent edit draft, saved-photo controls, preserved metadata, no repeated uploads, inline and legacy orders");
