export function isNetworkFetchError(err) {
  if (err == null) return false;
  const name = String(err.name || "");
  const msg = String(err.message != null ? err.message : err);
  if (name === "TypeError" && /load failed|failed to fetch|networkerror|fetch/i.test(msg)) return true;
  if (/failed to fetch|networkerror|load failed|network request failed|internet disconnected|err_network/i.test(msg))
    return true;
  return false;
}
