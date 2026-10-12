import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import { fetchSupabaseByIdsInChunks } from "./supabase-fetch.js";
import { isOfflineDataMode, readSnapshot } from "./offline-cache.js";

const summaries = new Map();
export function getOrderSummary(id) {
  return state.allOrders.find((row) => Number(row.id) === Number(id)) || summaries.get(Number(id));
}
export async function ensureOrderSummaries(ids) {
  const needed = [...new Set(ids.map(Number).filter((id) => id > 0 && !getOrderSummary(id)))];
  if (!needed.length) return;
  if (isOfflineDataMode()) {
    for (const row of readSnapshot()?.orders || []) summaries.set(Number(row.id), row);
    return;
  }
  const { data, error } = await fetchSupabaseByIdsInChunks((chunk) => supabaseClient
    .from("orders").select("id, order_type").in("id", chunk), needed);
  if (error) throw error;
  for (const row of data || []) summaries.set(Number(row.id), row);
}
