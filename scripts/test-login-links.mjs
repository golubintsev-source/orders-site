import assert from "node:assert/strict";

const profiles = [
  { id: "u-masha", email: "animashka89@gmail.com", login_key: "key-masha", role: "user" },
  { id: "u-new", email: "animashka89@mail.ru", login_key: "", role: "user" },
  { id: "u-dima", email: "golubintsev26@gmail.com", login_key: "key-dima", role: "admin" },
];

const generatedKeys = [];

function chain(result) {
  const self = {
    select: () => self,
    not: () => self,
    eq: async (_col, id) => {
      const row = profiles.find((p) => p.id === id);
      if (row && generatedKeys.at(-1)) row.login_key = generatedKeys.at(-1);
      return { error: null };
    },
    order: async () => result,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return self;
}

const supabaseClient = {
  from(table) {
    assert.equal(table, "profiles");
    return {
      select: () => chain({ data: profiles, error: null }),
      update: (payload) => {
        generatedKeys.push(payload.login_key);
        return chain({ error: null });
      },
    };
  },
};

function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    hidden: false,
    textContent: "",
    className: "",
    dataset: {},
    children: [],
    classList: { toggle() {} },
    append(...nodes) {
      el.children.push(...nodes);
    },
    appendChild(node) {
      el.children.push(node);
      return node;
    },
    setAttribute() {},
    replaceChildren() {
      el.children.length = 0;
    },
    addEventListener() {},
    closest() {
      return null;
    },
  };
  return el;
}

const tbody = makeEl("tbody");
const card = makeEl("div");
const msg = makeEl("p");

globalThis.window = {
  location: { origin: "https://example.test" },
  supabase: { createClient: () => supabaseClient },
};

globalThis.document = {
  getElementById(id) {
    if (id === "loginLinksCard") return card;
    if (id === "loginLinksTableBody") return tbody;
    if (id === "loginLinksMessage") return msg;
    return null;
  },
  createElement: makeEl,
};

const { loadLoginLinksSection } = await import("../js/login-links.js");
const { state } = await import("../js/state.js");
state.currentRole = "admin";

await loadLoginLinksSection();

assert.equal(card.hidden, false);
assert.equal(tbody.children.length, 3);

const names = tbody.children.map((tr) => tr.children[0].textContent);
assert.deepEqual(names, ["Маша", "Маша", "Дима"]);

const urls = tbody.children.map((tr) => tr.children[1].children[0].textContent);
assert.equal(urls[0], "https://example.test/login.html?key=key-masha");
assert.equal(generatedKeys.length, 1);
assert.match(generatedKeys[0], /^[0-9a-f-]{36}$/i);
assert.equal(urls[1], `https://example.test/login.html?key=${generatedKeys[0]}`);

console.log("ok");
