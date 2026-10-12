import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import { isUserExecutorOfTask } from "./task-form-shared.js";
import { mergeOrderTasksRowsForAllTasks } from "./offline-cache.js";
import { fetchAllSupabaseRows } from "./supabase-fetch.js";
function isActiveTask(row) {
  return row.is_completed !== true && row.is_completed !== 1 && row.is_completed !== "1";
}
function countMyPendingExecutorTasks(rows) {
  return (rows || []).filter((row) => isUserExecutorOfTask(row) && isActiveTask(row)).length;
}

export async function refreshMyTasksNavBadge() {
  const badge = document.getElementById("myTasksPendingBadge");
  const btn = document.getElementById("myTasksNavBtn");
  if (!badge || !btn) return;

  if (!state.currentUser) {
    badge.hidden = true;
    btn.classList.remove("my-tasks-nav-btn--has-pending");
    return;
  }

  const { data, error } = await fetchAllSupabaseRows(() => supabaseClient
    .from("order_tasks")
    .select("id, executor_emails, is_completed, created_at")
    .eq("is_completed", false)
    .is("deleted_at", null).order("id", { ascending: true }));

  if (error) {
    console.warn("Не удалось получить число невыполненных задач:", error);
    badge.hidden = true;
    btn.classList.remove("my-tasks-nav-btn--has-pending");
    return;
  }

  const n = countMyPendingExecutorTasks(mergeOrderTasksRowsForAllTasks(data || []));
  if (n > 0) {
    badge.textContent = n > 99 ? "99+" : String(n);
    badge.hidden = false;
    btn.classList.add("my-tasks-nav-btn--has-pending");
  } else {
    badge.hidden = true;
    btn.classList.remove("my-tasks-nav-btn--has-pending");
  }
}
