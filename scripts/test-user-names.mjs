import assert from "node:assert/strict";
import { displayNameByEmail, isKnownUserDisplayName, shortLoginByEmail } from "../js/user-names.js";
import { createRequire } from "node:module";

const { displayNameByEmail: displayNameByEmailApi } = createRequire(import.meta.url)(
  "../api/user-display-names.js",
);

assert.equal(displayNameByEmail("animashka89"), "Маша");
assert.equal(displayNameByEmail("ANIMASHKA89"), "Маша");
assert.equal(displayNameByEmail("animashka89@gmail.com"), "Маша");
assert.equal(displayNameByEmail("animashka89@mail.ru"), "Маша");
assert.equal(displayNameByEmail("Animashka89@Mail.Ru"), "Маша");
assert.equal(shortLoginByEmail("animashka89@gmail.com"), "Маша");
assert.equal(isKnownUserDisplayName("Маша"), true);

assert.equal(displayNameByEmailApi("animashka89"), "Маша");
assert.equal(displayNameByEmailApi("animashka89@gmail.com"), "Маша");
assert.equal(displayNameByEmailApi("animashka89@mail.ru"), "Маша");

assert.equal(displayNameByEmail("lexa@mail.ru"), "Алексей");
assert.equal(displayNameByEmail("golubintsev26@gmail.com"), "Дима");
assert.equal(displayNameByEmail("unknown.user@example.com"), "unknown.user");

console.log("ok");
