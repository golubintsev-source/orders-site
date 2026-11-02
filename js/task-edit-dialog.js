import { bindAutogrowTextarea } from "./autogrow-textarea.js";
import { renderTaskComposerHtml } from "./task-composer-markup.js";
import { supabaseClient } from "./config.js";
import { isOfflineDataMode } from "./offline-cache.js";
import {
  isUserAuthorOfTask, isUserExecutorOfTask, getCurrentUserEmail, ensureTaskExecutorsInList, normalizeExecutorEmails,
  getSelectedExecutorEmailsFrom,
} from "./task-form-shared.js";
import { createTaskAttachmentComposer } from "./task-attachments.js";

let opening = false;

export async function openTaskEditDialog(taskId, onSaved) {
  if (opening || document.getElementById("taskEditDialog")) return;
  if (isOfflineDataMode()) throw new Error("Для редактирования задачи подключитесь к интернету.");
  opening = true;
  let dialog;
  let composer;
  let disposeTextResize = () => {};
  let disposeReplyResize = () => {};
  try {
    const { data: task, error } = await supabaseClient.from("order_tasks")
      .select("id, author_login, body, executor_emails, due_at, attachments, order_id, source_order_field, highlight_order_field, executor_reply, is_completed")
      .eq("id", taskId).is("deleted_at", null).maybeSingle();
    if (error) throw error;
    if (!task) throw new Error("Задача удалена или недоступна.");
    if (!isUserAuthorOfTask(task)) throw new Error("Редактировать можно только свои задачи.");

    dialog = document.createElement("dialog");
    dialog.id = "taskEditDialog";
    dialog.className = "task-create-dialog";
    dialog.setAttribute("aria-labelledby", "taskEditTitle");
    dialog.innerHTML = `<form class="task-create-dialog-panel">
      <div class="task-create-dialog-header"><h3 id="taskEditTitle" class="task-create-dialog-title">Редактировать задачу</h3>
        <button type="button" class="task-edit-delete" data-field="delete">Удалить задачу</button></div>
      <label class="task-highlight-toggle"><input type="checkbox" data-field="highlight" /> Выделить</label>
      <div class="task-create-dialog-field"><label for="taskEdit-orderTaskTextInput" class="task-create-dialog-label">Текст</label>
        <div data-field="composer">${renderTaskComposerHtml()}</div>
        <input id="taskEdit-taskPhotoGalleryInput" type="file" accept="image/*" multiple hidden />
        <input id="taskEdit-taskPhotoCameraInput" type="file" accept="image/*" capture="environment" hidden />
        <div id="taskEdit-taskPendingAttachments" class="task-pending-attachments" aria-label="Вложения задачи" hidden></div>
      </div>
      <div class="task-create-dialog-field"><span class="task-create-dialog-label">Исполнители</span>
        <div id="taskEditExecutors" class="messages-create-group-users order-tasks-executors-list" role="group" aria-label="Исполнители задачи"></div>
        <p class="order-tasks-executors-hint" data-field="hint"></p></div>
      <label class="task-create-dialog-field"><span class="task-create-dialog-label">Ответ</span>
        <textarea class="task-create-dialog-text" data-field="reply" rows="1" aria-label="Ответ исполнителя"></textarea></label>
      <label class="task-highlight-toggle"><input type="checkbox" data-field="completed" /> Выполнено</label>
      <p class="task-create-dialog-error" role="alert" data-field="error" hidden></p>
      <div class="task-create-dialog-actions">
        <button type="submit" class="btn-primary task-create-dialog-submit">Сохранить</button>
        <button type="button" class="task-create-dialog-cancel">Отменить</button>
      </div></form>`;
    document.body.append(dialog);
    const field = (name) => dialog.querySelector(`[data-field="${name}"]`);
    const executors = dialog.querySelector("#taskEditExecutors");
    const form = dialog.querySelector("form");
    form.addEventListener("submit", (event) => event.preventDefault());
    const submit = dialog.querySelector('[type="submit"]');
    const cancel = dialog.querySelector('.task-create-dialog-cancel');
    let saving = false;
    let attachmentBusy = false;
    let executorsReady = false;
    const syncDisabled = () => {
      form.querySelectorAll("input, textarea, button").forEach((el) => { el.disabled = saving || attachmentBusy; });
      field("highlight").disabled = saving || attachmentBusy || !task.source_order_field;
      submit.disabled = saving || attachmentBusy || !executorsReady;
    };
    field("delete").addEventListener("click", async () => {
      if (saving || attachmentBusy) return;
      const errorEl = field("error");
      errorEl.hidden = true;
      saving = true;
      composer?.setBusy(true);
      syncDisabled();
      let deleted = false;
      try {
        const { softDeleteAuthorTask } = await import("./tasks.js");
        deleted = await softDeleteAuthorTask(task.id, null);
      } catch (error) {
        errorEl.textContent = error?.message || "Не удалось удалить задачу. Попробуйте ещё раз.";
        errorEl.hidden = false;
      } finally {
        saving = false;
        composer?.setBusy(false);
        syncDisabled();
      }
      if (deleted) dialog.close();
    });
    const close = () => { if (!saving && !attachmentBusy) dialog.close(); };
    dialog.addEventListener("close", () => { disposeTextResize(); disposeReplyResize(); composer?.dispose(); dialog.remove(); });
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
    cancel.addEventListener("click", close);
    dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
    // The editor owns its controls. Do not clone the create form: cloning form
    // controls is unreliable in iPhone standalone/PWA mode.
    const text = dialog.querySelector("#taskEdit-orderTaskTextInput");
    if (!text) throw new Error("Поле текста задачи недоступно. Обновите страницу.");
    text.rows = 1;
    text.value = task.body || "";
    field("highlight").checked = task.highlight_order_field === true;
    field("completed").checked = [true, 1, "1"].includes(task.is_completed);
    field("reply").value = task.executor_reply || "";
    field("reply").readOnly = !isUserExecutorOfTask(task);
    composer = createTaskAttachmentComposer({
      getElement: (id) => dialog.querySelector(`#taskEdit-${id}`),
      initialAttachments: task.attachments,
      cropHost: dialog,
      onError: (error) => {
        field("error").textContent = error?.message || "Не удалось добавить вложение.";
        field("error").hidden = false;
      },
      onBusyChange: (value) => { attachmentBusy = value; syncDisabled(); },
    });
    composer.init();

    submit.disabled = true;
    dialog.showModal();
    disposeTextResize = bindAutogrowTextarea(text);
    disposeReplyResize = bindAutogrowTextarea(field("reply"));
    await ensureTaskExecutorsInList(executors, field("hint"));
    // Preserve assigned people even if they are no longer in the user directory.
    for (const email of normalizeExecutorEmails(task.executor_emails)) {
      let input = [...executors.querySelectorAll("input[data-email]")]
        .find((el) => el.dataset.email.toLowerCase() === email.toLowerCase());
      if (!input) {
        const label = document.createElement("label");
        label.className = "messages-create-group-user order-tasks-executor-user";
        input = document.createElement("input");
        input.type = "checkbox";
        input.dataset.email = email;
        label.append(input, document.createTextNode(email));
        executors.append(label);
      }
      input.checked = true;
    }
    if (!dialog.isConnected) return;
    // A failed directory load must not silently drop executors.
    executorsReady = executors.dataset.loaded === "1";
    syncDisabled();
    text.focus();
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (saving || submit.disabled) return;
      const errorEl = field("error");
      errorEl.hidden = true;
      const body = text.value.trim();
      if (!body && !composer.hasAttachments()) {
        errorEl.textContent = "Введите текст задачи.";
        errorEl.hidden = false;
        return;
      }
      saving = true;
      composer.setBusy(true);
      syncDisabled();
      let saved;
      try {
        if (isOfflineDataMode()) throw new Error("Для сохранения подключитесь к интернету.");
        if (!isUserAuthorOfTask(task)) throw new Error("Редактировать можно только свои задачи.");
        const patch = {
          body, executor_emails: getSelectedExecutorEmailsFrom(executors),
          attachments: await composer.prepare(),
          highlight_order_field: Boolean(task.source_order_field && field("highlight").checked),
        };
        const completed = field("completed").checked;
        if (completed !== [true, 1, "1"].includes(task.is_completed)) patch.is_completed = completed;
        const replyChanged = isUserExecutorOfTask(task) && field("reply").value !== String(task.executor_reply ?? "");
        if (replyChanged) patch.executor_reply = field("reply").value;
        // Unchanged replies must not overwrite an executor's newer answer.
        let update = supabaseClient.from("order_tasks")
          .update(patch).eq("id", task.id).eq("author_login", task.author_login).is("deleted_at", null);
        if (replyChanged) update = update.eq("executor_reply", String(task.executor_reply ?? ""))
          .contains("executor_emails", [getCurrentUserEmail()]);
        const { data, error: saveError } = await update.select("id").maybeSingle();
        if (saveError) throw saveError;
        if (!data) throw new Error(replyChanged ? "Ответ уже изменён или изменился исполнитель. Обновите задачу перед сохранением." : "Задача удалена или больше недоступна.");
        saved = { ...task, ...patch };
      } catch (saveError) {
        errorEl.textContent = saveError?.message || "Не удалось сохранить задачу. Попробуйте ещё раз.";
        errorEl.hidden = false;
      } finally {
        saving = false;
        composer.setBusy(false);
        syncDisabled();
      }
      if (saved) {
        dialog.close();
        try { await onSaved?.(saved); }
        catch (refreshError) { console.error("Задача сохранена, ошибка обновления списка:", refreshError); }
      }
    });
  } catch (error) {
    disposeTextResize();
    disposeReplyResize();
    composer?.dispose();
    dialog?.remove();
    throw error;
  } finally {
    opening = false;
  }
}
