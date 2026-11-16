import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const currentUser = { id: "current", email: "current@example.test" };
const colleague = { id: "colleague", email: "colleague@example.test" };

function checkbox(label) {
  return { dataset: { email: label.email }, checked: false, closest: () => label };
}

function executorList() {
  return {
    dataset: {},
    inputs: [],
    set innerHTML(html) {
      this.inputs = [...html.matchAll(/data-email="([^"]+)"/g)].map((match) => checkbox({ email: match[1] }));
    },
    querySelectorAll(selector) {
      return selector.endsWith(":checked") ? this.inputs.filter((input) => input.checked) : this.inputs;
    },
    append(label) {
      this.inputs.push(label.input);
    },
  };
}

function hintElement() {
  return {
    hidden: true,
    set textContent(text) {
      this.text = text;
      this.retry = null;
    },
    append(button) {
      this.retry = button;
    },
  };
}

async function setup(responses) {
  let calls = 0;
  const warnings = [];
  const context = vm.createContext({
    console: { error: (...args) => warnings.push(args) },
    document: {
      createElement(tag) {
        if (tag === "button") return { addEventListener(_name, listener) { this.click = listener; } };
        return { get innerHTML() { return this.textContent; } };
      },
    },
  });
  const module = (name) => new vm.SourceTextModule(
    readFileSync(new URL(`../js/${name}`, import.meta.url), "utf8"),
    { context, identifier: name },
  );
  const directory = module("users-directory.js");
  const shared = module("task-form-shared.js");
  const dependencies = {
    "./config.js": { supabaseClient: { from(table) {
      assert.equal(table, "profiles");
      return {
        select() { return this; },
        not() { return this; },
        async order() {
          assert.ok(calls < responses.length, "unexpected directory request");
          return responses[calls++];
        },
      };
    } } },
    "./state.js": { state: { currentUser } },
    "./user-names.js": { displayNameByEmail: (email) => email },
    "./order-cell-highlights.js": { validOrderField: () => null },
    "./task-attachment-data.js": { normalizeTaskAttachments: () => [] },
  };
  const stubs = new Map();
  await shared.link((id) => {
    if (id === "./users-directory.js") return directory;
    if (!stubs.has(id)) {
      const exports = dependencies[id];
      stubs.set(id, new vm.SyntheticModule(Object.keys(exports), function () {
        for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
      }, { context }));
    }
    return stubs.get(id);
  });
  await shared.evaluate();
  return { ensure: shared.namespace.ensureTaskExecutorsInList, calls: () => calls, warnings };
}

const success = { data: [colleague, currentUser], error: null };
for (const failure of [{ error: { message: "Failed to fetch" } }, { data: [], error: null }]) {
  const { ensure, calls, warnings } = await setup([failure, success]);
  const first = executorList();
  const second = executorList();
  const hint = hintElement();
  const secondHint = hintElement();
  const removedProfile = { email: "previous@example.test" };
  removedProfile.input = checkbox(removedProfile);
  removedProfile.input.checked = true;
  const existingColleague = checkbox(colleague);
  existingColleague.checked = true;
  second.inputs.push(removedProfile.input, existingColleague);
  let loaded = 0;
  const onLoaded = () => { loaded++; };
  const pending = ensure(first, hint);
  assert.equal(ensure(first, hint), pending, "same picker shares an in-flight request");
  await Promise.all([pending, ensure(second, secondHint, onLoaded)]);
  assert.equal(calls(), 1, "different pickers share the directory request");
  assert.equal(warnings.length, 2);
  assert.equal(first.dataset.loaded, undefined);
  assert.equal(hint.hidden, false);
  assert.equal(hint.retry.textContent, "Повторить загрузку");
  assert.equal(second.inputs[0].checked, true, "load failure preserves saved assignees");

  secondHint.retry.click();
  await ensure(second, secondHint, onLoaded);
  await ensure(first, hint);
  assert.equal(calls(), 2, "a successful retry is cached");
  assert.equal(loaded, 1);
  assert.equal(first.dataset.loaded, "1");
  assert.equal(hint.hidden, true);
  assert.deepEqual(Array.from(first.inputs, (input) => input.dataset.email), [currentUser.email, colleague.email]);
  assert.deepEqual(Array.from(second.inputs.filter((input) => input.checked), (input) => input.dataset.email),
    [colleague.email, removedProfile.email]);
}

console.log("task executors: failed and empty responses, shared retry, successful cache and existing selections passed");
