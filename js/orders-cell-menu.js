import { validOrderField } from "./order-cell-highlights.js";
import { hideFloatingCellTooltip } from "./cell-tooltip.js";

const HOLD_MS = 500;
const MOVE_TOLERANCE = 10;

export function getOrderCellContext(cell) {
  const row = cell?.closest("tbody tr");
  if (!row || cell.matches(".td-actions")) return null;
  const orderCell = row.querySelector("td.td-order-id[data-order-id]");
  const orderId = Number(orderCell?.dataset.orderId);
  if (!Number.isFinite(orderId) || orderId === 0) return null;
  const text = String(cell.dataset.fulltext ?? cell.innerText ?? cell.textContent ?? "").trim();
  const orderLabel = String(orderCell?.innerText || orderCell?.textContent || orderId).trim();
  return { cell, orderId, orderLabel, text, orderField: validOrderField(cell.dataset.orderField) };
}

export async function copyOrderCellText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* Try the older clipboard path below. */ }
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.style.cssText = "position:fixed;left:-9999px;top:0;font-size:16px";
  document.body.appendChild(field);
  try {
    field.focus({ preventScroll: true });
    field.select();
    field.setSelectionRange(0, field.value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

export function initOrdersCellMenu({
  openTask = options => import("./task-create-dialog.js").then(module => module.openTaskCreateDialog(options)),
  findTask = context => import("./order-task-links.js").then(module => module.findOrderCellTask(context.orderId, context.orderField)),
  editTask = id => import("./task-edit-dialog.js").then(module => module.openTaskEditDialog(id, async () => {
    const [links, tasks] = await Promise.all([import("./order-task-links.js"), import("./tasks.js")]);
    await Promise.all([links.refreshActiveTaskOrderRefs(), tasks.refreshMyTasksNavBadge()]);
  })),
  reportError = error => window.alert?.(error?.message || "Не удалось открыть задачу. Попробуйте ещё раз."),
} = {}) {
  const table = document.getElementById("ordersTable");
  if (!table || table.dataset.cellMenuBound) return;
  table.dataset.cellMenuBound = "1";
  let timer = null;
  let press = null;
  let suppressed = null;
  let opening = false;
  const pointers = new Set();

  function cancelPress() {
    clearTimeout(timer);
    timer = null;
    press = null;
  }
  function contextForTarget(target) {
    if (!target?.closest || target.closest("button, a, input, textarea, select, label, [contenteditable=true]")) return null;
    const cell = target.closest("tbody td");
    const context = cell && table.contains(cell) ? getOrderCellContext(cell) : null;
    return context?.orderField ? context : null;
  }
  async function openFor(context) {
    cancelPress();
    if (opening || !context.cell.isConnected || context.orderId < 0) return;
    opening = true;
    hideFloatingCellTooltip();
    window.getSelection()?.removeAllRanges();
    context.cell.classList.add("order-cell-selected");
    suppressed = { cell: context.cell, until: Date.now() + 1500 };
    try {
      const existing = await findTask(context);
      if (existing?.__offlinePendingSync || (existing && Number(existing.id) <= 0)) {
        throw new Error("Сначала синхронизируйте задачу.");
      }
      if (existing) {
        await editTask(existing.id);
      } else {
        await openTask({
          body: context.text,
          sourceOrderId: context.orderId,
          sourceOrderLabel: context.orderLabel,
          sourceOrderField: context.orderField,
        });
      }
    } catch (error) {
      console.error("Не удалось открыть задачу:", error);
      reportError(error);
    } finally {
      opening = false;
      context.cell.classList.remove("order-cell-selected");
    }
  }

  document.addEventListener("pointerdown", event => {
    suppressed = null;
    pointers.add(event.pointerId);
    if (pointers.size > 1) cancelPress();
  }, true);
  table.addEventListener("pointerdown", event => {
    if (event.pointerType === "mouse" || pointers.size > 1) return;
    const context = contextForTarget(event.target);
    if (!context) return;
    press = { id: event.pointerId, x: event.clientX, y: event.clientY };
    timer = setTimeout(() => { void openFor(context); }, HOLD_MS);
  });
  document.addEventListener("pointermove", event => {
    if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > MOVE_TOLERANCE) cancelPress();
  }, { passive: true });
  const release = event => {
    pointers.delete(event.pointerId);
    if (press?.id === event.pointerId) cancelPress();
    if (suppressed) suppressed.until = Date.now() + 700;
  };
  document.addEventListener("pointerup", release, true);
  document.addEventListener("pointercancel", event => { release(event); cancelPress(); }, true);
  table.addEventListener("click", event => {
    if (suppressed && Date.now() < suppressed.until && suppressed.cell.contains(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressed = null;
    }
  }, true);
  table.addEventListener("contextmenu", event => {
    const context = contextForTarget(event.target);
    if (!context) return;
    event.preventDefault();
    if (pointers.size <= 1) void openFor(context);
  });
  document.addEventListener("orders-table-will-render", cancelPress);
  window.addEventListener("blur", () => { pointers.clear(); cancelPress(); });
}

