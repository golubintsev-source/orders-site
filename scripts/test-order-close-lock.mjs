import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(
  path.join(here, "..", "supabase_orders_lock_edit_user_lite.sql"),
  "utf8",
);

assert.match(sql, /BEFORE INSERT OR UPDATE OF payment_status ON public\.orders/i);
assert.match(sql, /NEW\.payment_status = 'Заказ закрыт'/);
assert.match(sql, /OLD\.payment_status IS DISTINCT FROM NEW\.payment_status/);
assert.match(sql, /NEW\.lock_edit_for_user_lite := 1/);
assert.match(sql, /SECURITY INVOKER/i);

console.log("order close lock tests: ok");
