import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../supabase_database_io_optimization.sql", import.meta.url),
  "utf8",
);

const emailFunction = sql.match(
  /create or replace function public\.current_user_email\(\)[\s\S]*?\$\$;/i,
)?.[0];

assert.ok(emailFunction, "current_user_email must be defined");
assert.doesNotMatch(
  emailFunction,
  /profiles/i,
  "current_user_email must not read profiles",
);
assert.match(emailFunction, /auth\.jwt\(\)/i);

for (const indexName of [
  "contractor_checks_created_by_idx",
  "group_chats_created_by_idx",
  "group_messages_sender_id_idx",
  "order_files_order_id_idx",
  "order_files_uploaded_by_idx",
]) {
  assert.match(sql, new RegExp(`create index if not exists ${indexName}`, "i"));
}

assert.match(sql, /drop index if exists public\.site_access_logs_page_path_idx/i);
assert.doesNotMatch(sql, /drop index[^;]*site_access_logs_user_id_idx/i);

for (const table of [
  "group_chat_reads",
  "user_messages",
  "order_tasks",
  "push_subscriptions",
]) {
  assert.match(
    sql,
    new RegExp(`alter table public\\.${table} set \\([\\s\\S]*?autovacuum_vacuum_threshold`, "i"),
  );
}

assert.match(sql, /\(select auth\.uid\(\)\)/i);
assert.match(sql, /\(select public\.current_app_role\(\)\)/i);
assert.match(
  sql,
  /task_visible_to_user\([\s\S]*?executor_emails,[\s\S]*?\(select public\.current_user_email\(\)\)/i,
);

console.log("Database IO migration checks passed.");
