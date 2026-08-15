/**
 * Helpers for Supabase/PostgREST list reads.
 * Default API Max Rows is ~1000 per request; larger sets are silently truncated
 * unless the client paginates with .range().
 */

/** Default PostgREST/Supabase max rows per request. */
export const SUPABASE_PAGE_SIZE = 1000;

/**
 * Load every row matching a query by paging with .range().
 * @param {() => { range: (from: number, to: number) => PromiseLike<{ data: any[] | null, error: any }> }} buildQuery
 *   Factory that returns a fresh filtered/ordered query (without .range / .limit).
 * @param {{ pageSize?: number }} [options]
 * @returns {Promise<{ data: any[] | null, error: any }>}
 */
export async function fetchAllSupabaseRows(buildQuery, { pageSize = SUPABASE_PAGE_SIZE } = {}) {
  const size = Math.max(1, Number(pageSize) || SUPABASE_PAGE_SIZE);
  const all = [];
  let from = 0;

  for (;;) {
    const { data, error } = await buildQuery().range(from, from + size - 1);
    if (error) return { data: null, error };

    const rows = data || [];
    all.push(...rows);
    if (rows.length < size) break;
    from += size;
  }

  return { data: all, error: null };
}

/**
 * Fetch rows for a large id list in chunks (avoids URL length and max-rows truncation).
 * @param {(chunkIds: any[]) => PromiseLike<{ data: any[] | null, error: any }>} fetchChunk
 * @param {any[]} ids
 * @param {{ chunkSize?: number }} [options]
 */
export async function fetchSupabaseByIdsInChunks(fetchChunk, ids, { chunkSize = 200 } = {}) {
  const unique = [];
  const seen = new Set();
  for (const id of ids || []) {
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }

  const size = Math.max(1, Number(chunkSize) || 200);
  const all = [];

  for (let i = 0; i < unique.length; i += size) {
    const chunk = unique.slice(i, i + size);
    const { data, error } = await fetchChunk(chunk);
    if (error) return { data: null, error };
    if (data?.length) all.push(...data);
  }

  return { data: all, error: null };
}
