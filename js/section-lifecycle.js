/** One active navigation. Imports are cached; data refreshes on each completed re-entry. */
export function createSectionLifecycle(loaders) {
  let active = null;
  const modules = new Map();
  const initialized = new Set();
  function leave(id) {
    if (active?.id === id) active = null;
    modules.get(id)?.leave?.();
  }
  function enter(id, options = {}) {
    if (active?.id === id && active.key === options.loadKey && active.pending) return active.promise;
    const request = { id, key: options.loadKey, pending: true, promise: null };
    active = request;
    const current = () => active === request;
    request.promise = Promise.resolve().then(async () => {
      if (!current() || !loaders[id]) return;
      const section = modules.get(id) || await loaders[id]();
      modules.set(id, section);
      if (!current()) return;
      await section.prepare?.(current);
      if (!current()) return;
      if (!initialized.has(id)) {
        await section.init?.();
        initialized.add(id);
      }
      if (!current()) return;
      await section.load?.(options, current);
    }).finally(() => { request.pending = false; });
    return request.promise;
  }
  return { enter, leave };
}
