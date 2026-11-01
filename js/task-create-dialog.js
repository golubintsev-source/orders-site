import {
  defaultTaskDueAtLocal,
  datetimeLocalToIso,
  ensureTaskExecutorsInList,
  getSelectedExecutorEmailsFrom,
  insertTask,
  resetTaskExecutorsList,
} from "./task-form-shared.js";

let dialogInited = false;
/** @type {{ id: string | number, kind: string } | null} */
let pendingSourceMessage = null;
/** @type {number | null} */
let pendingSourceOrderId = null;

function clearPendingSourceMessage() {
  pendingSourceMessage = null;
  pendingSourceOrderId = null;
}

function getDialogEls() {
  return {
    dialog: document.getElementById("taskCreateDialog"),
    textInput: document.getElementById("taskCreateDialogText"),
    titleEl: document.getElementById("taskCreateDialogTitle"),
    executorsList: document.getElementById("taskCreateDialogExecutors"),
    executorsHint: document.getElementById("taskCreateDialogExecutorsHint"),
    dueInput: document.getElementById("taskCreateDialogDueAt"),
    errorEl: document.getElementById("taskCreateDialogError"),
    submitBtn: document.getElementById("taskCreateDialogSubmitBtn"),
    cancelBtn: document.getElementById("taskCreateDialogCancelBtn"),
    closeBtn: document.getElementById("taskCreateDialogCloseBtn"),
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

function resetDialogForm() {
  const { textInput, dueInput, executorsList, titleEl } = getDialogEls();
  if (titleEl) titleEl.textContent = "Новая задача";
  if (textInput) textInput.value = "";
  if (dueInput) dueInput.value = defaultTaskDueAtLocal();
  resetTaskExecutorsList(executorsList);
  setDialogError("");
  clearPendingSourceMessage();
}

function closeTaskCreateDialog() {
  const { dialog } = getDialogEls();
  if (!dialog) return;
  if (typeof dialog.close === "function" && dialog.open) {
    dialog.close();
  }
}

async function submitTaskCreateDialog() {
  const { textInput, executorsList, dueInput, submitBtn } = getDialogEls();
  const text = (textInput?.value || "").trim();
  if (!text) {
    setDialogError("Введите текст задачи.");
    return;
  }

  setDialogError("");
  if (submitBtn) submitBtn.disabled = true;

  const executorEmails = getSelectedExecutorEmailsFrom(executorsList);
  const dueAt = datetimeLocalToIso(dueInput?.value);
  const source = pendingSourceMessage;
  const sourceOrderId = pendingSourceOrderId;
  const { error } = await insertTask({
    body: text,
    executorEmails,
    dueAt,
    sourceMessageId: source?.id ?? null,
    sourceMessageKind: source?.kind ?? null,
    orderId: sourceOrderId,
  });

  if (submitBtn) submitBtn.disabled = false;

  if (error) {
    console.error("Ошибка создания задачи:", error);
    setDialogError("Не удалось сохранить задачу.");
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
      m.addActiveTaskOrderRef(sourceOrderId);
      m.applyOrderTaskHighlightsInDom();
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
} = {}) {
  initTaskCreateDialog();
  const { dialog, textInput, dueInput, executorsList, executorsHint, titleEl } = getDialogEls();
  if (!dialog) return;

  pendingSourceMessage =
    sourceMessageId != null && sourceMessageKind
      ? { id: sourceMessageId, kind: sourceMessageKind }
      : null;
  pendingSourceOrderId =
    sourceOrderId != null && Number.isFinite(Number(sourceOrderId)) && Number(sourceOrderId) > 0
      ? Number(sourceOrderId)
      : null;

  if (titleEl) {
    const orderLabel = String(sourceOrderLabel || pendingSourceOrderId || "").trim();
    titleEl.textContent = pendingSourceOrderId != null
      ? `Создание задачи к заказу № ${orderLabel}`
      : "Новая задача";
  }

  await ensureTaskExecutorsInList(executorsList, executorsHint);

  if (textInput) textInput.value = String(body || "").trim();
  if (dueInput) dueInput.value = defaultTaskDueAtLocal();
  resetTaskExecutorsList(executorsList);
  setDialogError("");

  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  }
}

export function initTaskCreateDialog() {
  const { dialog, submitBtn, cancelBtn, closeBtn } = getDialogEls();
  if (!dialog) return;
  // A modal inside a display:none section can make the page inert while remaining
  // invisible in iOS. Also relocate dialogs from older cached HTML shells.
  if (dialog.parentElement !== document.body) document.body.appendChild(dialog);
  if (dialogInited) return;
  dialogInited = true;

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
