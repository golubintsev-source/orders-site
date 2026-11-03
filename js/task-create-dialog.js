import { createTaskAttachmentComposer } from "./task-attachments.js";
import { renderTaskComposerHtml } from "./task-composer-markup.js";
import { validOrderField } from "./order-cell-highlights.js";
import {
  ensureTaskExecutorsInList,
  getSelectedExecutorEmailsFrom,
  insertTask,
  resetTaskExecutorsList,
} from "./task-form-shared.js";
import { buildOrderEditUrl } from "./app-routes.js";
import { buildOrderNumberText, loadTaskOrderField, saveTaskOrderField } from "./task-order-field-editor.js";

let dialogInited = false;
let attachmentComposer = null;
let saving = false;
/** @type {{ id: string | number, kind: string } | null} */
let pendingSourceMessage = null;
/** @type {number | null} */
let pendingSourceOrderId = null;
let pendingSourceOrderField = null;
let pendingOrderFieldState = null;

function clearPendingSourceMessage() {
  pendingSourceMessage = null;
  pendingSourceOrderId = null;
  pendingSourceOrderField = null;
  pendingOrderFieldState = null;
}

function getDialogEls() {
  return {
    dialog: document.getElementById("taskCreateDialog"),
    textInput: document.getElementById("taskCreateDialogText"),
    titleEl: document.getElementById("taskCreateDialogTitle"),
    highlightInput: document.getElementById("taskCreateDialogHighlight"),
    executorsList: document.getElementById("taskCreateDialogExecutors"),
    executorsHint: document.getElementById("taskCreateDialogExecutorsHint"),
    errorEl: document.getElementById("taskCreateDialogError"),
    submitBtn: document.getElementById("taskCreateDialogSubmitBtn"),
    cancelBtn: document.getElementById("taskCreateDialogCancelBtn"),
    closeBtn: document.getElementById("taskCreateDialogCloseBtn"),
    orderFieldBlock: document.getElementById("taskCreateDialogOrderFieldBlock"),
    orderFieldLabel: document.getElementById("taskCreateDialogOrderFieldLabel"),
    orderFieldValue: document.getElementById("taskCreateDialogOrderFieldValue"),
    orderFieldHint: document.getElementById("taskCreateDialogOrderFieldHint"),
  };
}

function setDialogError(message) {
  const { errorEl } = getDialogEls();
  if (!errorEl) return;
  const text = String(message || "").trim();
  if (!text) {
    errorEl.textContent = "";
    errorEl.hidden = true;
    return;
  }
  errorEl.textContent = text;
  errorEl.hidden = false;
}

function syncCreateDisabled() {
  const { dialog, submitBtn, cancelBtn, closeBtn, textInput, highlightInput, orderFieldValue } = getDialogEls();
  const busy = saving || attachmentComposer?.isBusy();
  for (const el of [submitBtn, cancelBtn, closeBtn, textInput]) {
    if (el) el.disabled = Boolean(busy);
  }
  if (highlightInput) highlightInput.disabled = Boolean(busy) || !pendingSourceOrderField;
  if (orderFieldValue) orderFieldValue.disabled = Boolean(busy) || !pendingOrderFieldState?.editable;
  dialog?.querySelectorAll('#taskCreateDialogExecutors input').forEach(el => { el.disabled = Boolean(busy); });
}

function resetDialogForm() {
  if (saving || attachmentComposer?.isBusy()) return;
  attachmentComposer?.clear();
  const { textInput, executorsList, titleEl, orderFieldBlock, orderFieldValue, orderFieldHint } = getDialogEls();
  if (titleEl) titleEl.textContent = "Новая задача";
  const highlight = document.getElementById("taskCreateDialogHighlight");
  if (highlight) highlight.checked = false;
  if (textInput) textInput.value = "";
  if (orderFieldBlock) orderFieldBlock.hidden = true;
  if (orderFieldValue) { orderFieldValue.value = ""; orderFieldValue.hidden = false; }
  if (orderFieldHint) orderFieldHint.hidden = true;
  resetTaskExecutorsList(executorsList);
  setDialogError("");
  clearPendingSourceMessage();
}

function closeTaskCreateDialog() {
  if (saving || attachmentComposer?.isBusy()) return;
  const { dialog } = getDialogEls();
  if (!dialog) return;
  if (typeof dialog.close === "function" && dialog.open) {
    dialog.close();
  }
}

async function submitTaskCreateDialog() {
  const { textInput, executorsList, submitBtn } = getDialogEls();
  if (saving || attachmentComposer?.isBusy()) return;
  const text = (textInput?.value || "").trim();
  if (!text && !attachmentComposer?.hasAttachments()) {
    setDialogError("Введите текст задачи.");
    return;
  }

  setDialogError("");
  if (submitBtn) submitBtn.disabled = true;

  const executorEmails = getSelectedExecutorEmailsFrom(executorsList);
  const source = pendingSourceMessage;
  const sourceOrderId = pendingSourceOrderId;
  let error = null;
  saving = true;
  attachmentComposer?.setBusy(true);
  syncCreateDisabled();
  try {
    const attachments = attachmentComposer ? await attachmentComposer.prepare() : [];
    if (pendingOrderFieldState?.editable) {
      const currentOrderFieldValue = getDialogEls().orderFieldValue?.value;
      const orderFieldChanged = await saveTaskOrderField(
        sourceOrderId,
        pendingSourceOrderField,
        currentOrderFieldValue,
        pendingOrderFieldState.value,
      );
      // Если создание задачи затем завершится ошибкой, повторная попытка не должна
      // снова сохранять уже изменённое поле заказа и получать «Нет изменений».
      if (orderFieldChanged) pendingOrderFieldState.value = String(currentOrderFieldValue ?? "");
    }
    const result = await insertTask({
      body: text, executorEmails, attachments,
      sourceMessageId: source?.id ?? null,
      sourceMessageKind: source?.kind ?? null,
      orderId: sourceOrderId,
      sourceOrderField: pendingSourceOrderField,
      highlightOrderField: getDialogEls().highlightInput?.checked === true,
    });
    error = result.error;
  } catch (saveError) {
    error = saveError;
  } finally {
    saving = false;
    attachmentComposer?.setBusy(false);
    syncCreateDisabled();
  }
  if (error) {
    console.error("Ошибка создания задачи:", error);
    setDialogError(error.message || "Не удалось сохранить задачу.");
    return;
  }

  closeTaskCreateDialog();
  resetDialogForm();

  void import("./tasks.js").then((m) => {
    void m.loadAllTasks();
    if (sourceOrderId != null) void m.loadOrderTasks();
    void m.refreshMyTasksNavBadge();
  });
  if (source?.id != null && source?.kind) {
    void import("./message-task-links.js").then((m) => {
      m.addActiveTaskMessageRef(source.kind, source.id);
      m.applyMessageTaskHighlightsInFeed();
    });
  }
  if (sourceOrderId != null) {
    void import("./order-task-links.js").then((m) => {
      void m.refreshActiveTaskOrderRefs();
    });
  }
  clearPendingSourceMessage();
}

export async function openTaskCreateDialog({
  body = "",
  sourceMessageId = null,
  sourceMessageKind = null,
  sourceOrderId = null,
  sourceOrderLabel = "",
  sourceOrderField = null,
} = {}) {
  initTaskCreateDialog();
  const {
    dialog, textInput, executorsList, executorsHint, titleEl,
    orderFieldBlock, orderFieldLabel, orderFieldValue, orderFieldHint,
  } = getDialogEls();
  if (!dialog) return;

  pendingSourceMessage =
    sourceMessageId != null && sourceMessageKind
      ? { id: sourceMessageId, kind: sourceMessageKind }
      : null;
  pendingSourceOrderId =
    sourceOrderId != null && Number.isFinite(Number(sourceOrderId)) && Number(sourceOrderId) > 0
      ? Number(sourceOrderId)
      : null;

  pendingSourceOrderField = pendingSourceOrderId != null ? validOrderField(sourceOrderField) : null;
  const highlight = getDialogEls().highlightInput;
  if (highlight) {
    highlight.checked = pendingSourceOrderField != null;
    highlight.disabled = pendingSourceOrderField == null;
  }
  if (titleEl) {
    const orderLabel = String(sourceOrderLabel || pendingSourceOrderId || "").trim();
    if (pendingSourceOrderId != null) {
      const link = document.createElement("a");
      link.className = "task-dialog-order-link";
      link.href = buildOrderEditUrl(pendingSourceOrderId);
      link.dataset.orderId = String(pendingSourceOrderId);
      link.textContent = orderLabel || buildOrderNumberText(pendingSourceOrderId);
      link.title = `Редактировать заказ ${link.textContent}`;
      titleEl.replaceChildren(document.createTextNode("Создание задачи к заказу № "), link);
      link.addEventListener("click", (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        if (saving || attachmentComposer?.isBusy()) return;
        closeTaskCreateDialog();
        void import("./orders.js").then((module) => module.editOrder(pendingSourceOrderId));
      }, { once: true });
    } else {
      titleEl.textContent = "Новая задача";
    }
  }

  pendingOrderFieldState = null;
  if (orderFieldBlock) orderFieldBlock.hidden = true;
  if (pendingSourceOrderId != null && pendingSourceOrderField && orderFieldBlock && orderFieldLabel && orderFieldValue) {
    try {
      pendingOrderFieldState = await loadTaskOrderField(pendingSourceOrderId, pendingSourceOrderField);
      if (pendingOrderFieldState) {
        orderFieldBlock.hidden = false;
        orderFieldLabel.textContent = pendingOrderFieldState.label;
        orderFieldValue.hidden = false;
        orderFieldValue.type = pendingOrderFieldState.inputType;
        if (pendingOrderFieldState.inputType === "number") orderFieldValue.step = "any";
        orderFieldValue.value = pendingOrderFieldState.value;
        if (orderFieldHint) {
          orderFieldHint.textContent = pendingOrderFieldState.editable ? "" : "Расчётное поле нельзя изменить напрямую.";
          orderFieldHint.hidden = pendingOrderFieldState.editable;
        }
      }
    } catch (loadError) {
      if (orderFieldBlock) orderFieldBlock.hidden = false;
      if (orderFieldLabel) orderFieldLabel.textContent = "Поле заказа";
      if (orderFieldValue) orderFieldValue.hidden = true;
      if (orderFieldHint) {
        orderFieldHint.textContent = loadError?.message || "Не удалось загрузить поле заказа.";
        orderFieldHint.hidden = false;
      }
    }
  }

  await ensureTaskExecutorsInList(executorsList, executorsHint);

  if (textInput) textInput.value = String(body || "").trim();
  resetTaskExecutorsList(executorsList);
  setDialogError("");

  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  }
  syncCreateDisabled();
}

export function initTaskCreateDialog() {
  const { dialog, submitBtn, cancelBtn, closeBtn } = getDialogEls();
  if (!dialog) return;
  // A modal inside a display:none section can make the page inert while remaining
  // invisible in iOS. Also relocate dialogs from older cached HTML shells.
  if (dialog.parentElement !== document.body) document.body.appendChild(dialog);
  if (dialogInited) return;
  dialogInited = true;

  const host = document.getElementById("taskCreateComposerHost");
  if (host) {
    host.innerHTML = renderTaskComposerHtml("taskCreate-", "taskCreateDialogText");
    attachmentComposer = createTaskAttachmentComposer({
      getElement: id => id === "orderTaskTextInput"
        ? document.getElementById("taskCreateDialogText")
        : document.getElementById(`taskCreate-${id}`),
      cropHost: dialog,
      onError: error => setDialogError(error?.message || "Не удалось добавить вложение."),
      onBusyChange: syncCreateDisabled,
    });
    attachmentComposer.init();
  }

  submitBtn?.addEventListener("click", () => void submitTaskCreateDialog());
  cancelBtn?.addEventListener("click", () => {
    closeTaskCreateDialog();
    resetDialogForm();
  });
  closeBtn?.addEventListener("click", () => {
    closeTaskCreateDialog();
    resetDialogForm();
  });

  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeTaskCreateDialog();
    resetDialogForm();
  });

  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) {
      closeTaskCreateDialog();
      resetDialogForm();
    }
  });
}
