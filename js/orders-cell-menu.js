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
  // data-fulltext contains the original value, even when the visible chip is truncated.
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
} = {}) {
  const table = document.getElementById("ordersTable");
  if (!table || table.dataset.cellMenuBound) return;
  table.dataset.cellMenuBound = "1";
  let timer = null;
  let press = null;
  let active = null;
  let suppressed = null;
  const pointers = new Set();
  const menu = document.createElement("div");
  menu.className = "orders-cell-menu";
  menu.hidden = true;
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-label", "Действия с ячейкой заказа");
  const preview = document.createElement("div");
  preview.className = "orders-cell-menu-text";
  const actions = document.createElement("div");
  actions.className = "orders-cell-menu-actions";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Скопировать";
  const task = document.createElement("button");
  task.type = "button";
  task.textContent = "Создать задачу";
  const status = document.createElement("div");
  status.className = "orders-cell-menu-status";
  status.setAttribute("role", "status");
  actions.append(copy, task);
  menu.append(preview, actions, status);
  document.body.appendChild(menu);

  function cancelPress() {
    clearTimeout(timer);
    timer = null;
    press = null;
  }
  function close() {
    cancelPress();
    active?.cell.classList.remove("order-cell-selected");
    active = null;
    menu.hidden = true;
  }
  function contextForTarget(target) {
    if (!target?.closest || target.closest("button, a, input, textarea, select, label, [contenteditable=true]")) return null;
    const cell = target.closest("tbody td");
    return cell && table.contains(cell) ? getOrderCellContext(cell) : null;
  }
  function show(context) {
    close();
    if (!context.cell.isConnected) return;
    hideFloatingCellTooltip();
    window.getSelection()?.removeAllRanges();
    active = context;
    context.cell.classList.add("order-cell-selected");
    preview.textContent = context.text || "Пустая ячейка";
    copy.disabled = !context.text;
    task.disabled = context.orderId < 0;
    task.title = context.orderId < 0 ? "Сначала синхронизируйте заказ" : "";
    status.textContent = "";
    menu.hidden = false;
    // Use viewport coordinates, including the visual viewport when iOS is zoomed.
    const viewport = window.visualViewport;
    const leftEdge = viewport?.offsetLeft || 0;
    const topEdge = viewport?.offsetTop || 0;
    const width = viewport?.width || window.innerWidth;
    const height = viewport?.height || window.innerHeight;
    menu.style.maxWidth = `${Math.max(0, width - 16)}px`;
    const rect = context.cell.getBoundingClientRect();
    const left = Math.max(leftEdge + 8, Math.min(rect.left, leftEdge + width - menu.offsetWidth - 8));
    const below = rect.bottom + 8;
    const top = below + menu.offsetHeight <= topEdge + height - 8
      ? below : Math.max(topEdge + 8, Math.min(rect.top - menu.offsetHeight - 8, topEdge + height - menu.offsetHeight - 8));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    suppressed = { cell: context.cell, until: Date.now() + 1500 };
  }

  copy.addEventListener("click", async () => {
    const context = active;
    if (!context) return;
    const ok = await copyOrderCellText(context.text);
    if (active !== context) return;
    if (ok) close();
    else status.textContent = "Не удалось скопировать. Попробуйте ещё раз.";
  });
  task.addEventListener("click", async () => {
    if (!active || active.orderId < 0 || task.disabled) return;
    const context = active;
    task.disabled = true;
    try {
      await openTask({ body: context.text, sourceOrderId: context.orderId, sourceOrderLabel: context.orderLabel, sourceOrderField: context.orderField });
      close();
    } catch (error) {
      console.error("Не удалось открыть создание задачи:", error);
      if (active === context) status.textContent = "Не удалось открыть задачу. Попробуйте ещё раз.";
    } finally {
      task.disabled = false;
    }
  });

  document.addEventListener("pointerdown", event => {
    suppressed = null;
    pointers.add(event.pointerId);
    if (pointers.size > 1) close();
    else if (!menu.contains(event.target)) close();
  }, true);
  table.addEventListener("pointerdown", event => {
    if (event.pointerType === "mouse" || pointers.size > 1) return;
    const context = contextForTarget(event.target);
    if (!context) return;
    press = { id: event.pointerId, x: event.clientX, y: event.clientY };
    timer = setTimeout(() => show(context), HOLD_MS);
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
  document.addEventListener("pointercancel", event => { release(event); close(); }, true);
  // Prevent the synthetic tap after a hold from opening a tooltip/order action.
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
    // iOS may emit contextmenu before or after our hold timer.
    if (pointers.size <= 1 && active?.cell !== context.cell) show(context);
  });
  document.addEventListener("scroll", event => {
    if (!menu.contains(event.target)) close();
  }, { capture: true, passive: true });
  document.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
  document.addEventListener("orders-table-will-render", close);
  window.addEventListener("resize", close);
  window.addEventListener("blur", () => { pointers.clear(); close(); });
  window.visualViewport?.addEventListener("resize", close);
}
