const boundFields = new WeakMap();

export function resizeTextarea(field) {
  if (!field || !field.clientWidth) return;
  field.style.height = "auto";
  const borderHeight = field.offsetHeight - field.clientHeight;
  field.style.height = `${field.scrollHeight + borderHeight}px`;
}

export function bindAutogrowTextarea(field) {
  if (!field) return () => {};
  if (boundFields.has(field)) return boundFields.get(field);
  const resize = () => resizeTextarea(field);
  field.addEventListener("input", resize);
  window.addEventListener("resize", resize);
  let observer;
  if (typeof ResizeObserver !== "undefined") {
    let previousWidth = 0;
    observer = new ResizeObserver(entries => {
      const width = entries[0].contentRect.width;
      if (width === previousWidth) return;
      previousWidth = width;
      resize();
    });
    observer.observe(field);
  }
  resize();
  const dispose = () => {
    field.removeEventListener("input", resize);
    window.removeEventListener("resize", resize);
    observer?.disconnect();
    boundFields.delete(field);
  };
  boundFields.set(field, dispose);
  return dispose;
}
