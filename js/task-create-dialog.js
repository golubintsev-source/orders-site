import {
  defaultTaskDueAtLocal,
  datetimeLocalToIso,
  ensureTaskExecutorsInList,
  getSelectedExecutorEmailsFrom,
  insertTask,
  resetTaskExecutorsList,
} from "./task-form-shared.js";

let dialogInited = false;

function getDialogEls() {
  return {
    dialog: document.getElementById("taskCreateDialog"),
    textInput: document.getElementById("taskCreateDialogText"),
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
  const { textInput, dueInput, executorsList } = getDialogEls();
  if (textInput) textInput.value = "";
  if (dueInput) dueInput.value = defaultTaskDueAtLocal();
  resetTaskExecutorsList(executorsList);
  setDialogError("");
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
  const { error } = await insertTask({ body: text, executorEmails, dueAt });

  if (submitBtn) submitBtn.disabled = false;

  if (error) {
    console.error("Ошибка создания задачи:", error);
    setDialogError("Не удалось сохранить задачу.");
    return;
  }

  closeTaskCreateDialog();
  resetDialogForm();

  void import("./tasks.js").then((m) => {
    void m.loadOrderTasks();
    void m.loadAllTasks();
  });
}

export async function openTaskCreateDialog({ body = "" } = {}) {
  const { dialog, textInput, dueInput, executorsList, executorsHint } = getDialogEls();
  if (!dialog) return;

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
  if (dialogInited) return;
  dialogInited = true;

  const { dialog, submitBtn, cancelBtn, closeBtn } = getDialogEls();
  if (!dialog) return;

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
