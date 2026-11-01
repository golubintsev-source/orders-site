const boundFields = new WeakSet();

export function resizeTextarea(field) {
  if (!field || !field.clientWidth) return;
  field.style.height = "auto";
  const borderHeight = field.offsetHeight - field.clientHeight;
  field.style.height = `${field.scrollHeight + borderHeight}px`;
}

export function bindAutogrowTextarea(field) {
  if (!field || boundFields.has(field)) return;
  boundFields.add(field);
  const resize = () => resizeTextarea(field);
  field.addEventListener("input", resize);
  window.addEventListener("resize", resize);
  if (typeof ResizeObserver !== "undefined") {
    let previousWidth = 0;
    const observer = new ResizeObserver(entries => {
      const width = entries[0].contentRect.width;
      if (width === previousWidth) return;
      previousWidth = width;
      resize();
    });
    observer.observe(field);
  }
  resize();
}
