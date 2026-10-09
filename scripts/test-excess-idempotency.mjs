import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../js/excess.js", import.meta.url), "utf8");
const schema = await readFile(new URL("../supabase_excesses_table.sql", import.meta.url), "utf8");
const migration = await readFile(
  new URL("../supabase_excesses_idempotency.sql", import.meta.url),
  "utf8",
);
const sw = await readFile(new URL("../sw.js", import.meta.url), "utf8");

assert.match(source, /row\.dataset\.saveIdempotencyKey = createExcessSaveIdempotencyKey\(\)/);
assert.match(source, /save_idempotency_key: row\.saveIdempotencyKey/);
assert.match(source, /if \(excessSavePromise\) return excessSavePromise/);
assert.match(source, /async function insertExcessesIdempotently/);
assert.match(source, /code === "23505"/);
assert.match(source, /\.in\("save_idempotency_key", keys\)/);
assert.match(schema, /save_idempotency_key text/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /Duplicate excess save_idempotency_key/);
assert.doesNotMatch(migration, /DELETE\s+FROM/i);
assert.match(sw, /orders-site-static-v80/);

console.log("excess idempotency tests: ok");
