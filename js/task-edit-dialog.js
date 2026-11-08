import { bindAutogrowTextarea } from "./autogrow-textarea.js";
import { renderTaskComposerHtml } from "./task-composer-markup.js";
import { supabaseClient } from "./config.js";
import {
  isUserAuthorOfTask, isUserExecutorOfTask, getCurrentUserEmail, ensureTaskExecutorsInList,
  getSelectedExecutorEmailsFrom,
  visibleTaskExecutorEmails,
} from "./task-form-shared.js";
import { createTaskAttachmentComposer } from "./task-attachments.js";
import { buildOrderEditUrl } from "./app-routes.js";
import { buildOrderNumberText, loadTaskOrderField, saveTaskOrderField } from "./task-order-field-editor.js";
import { displayNameGenitiveByEmail } from "./user-names.js";

let opening = false;

export async function openTaskEditDialog(taskId, onSaved) {
  if (opening || document.getElementById("taskEditDialog")) return;
  opening = true;
  let dialog;
  let composer;
  let disposeTextResize = () => {};
  let disposeReplyResize = () => {};
  let disposeOrderFieldResize = () => {};
  try {
    const { data: task, error } = await supabaseClient.from("order_tasks")
      .select("id, author_login, body, executor_emails, due_at, attachments, order_id, source_order_field, highlight_order_field, executor_reply, is_completed")
      .eq("id", taskId).is("deleted_at", null).maybeSingle();
    if (error) throw error;
    if (!task) throw new Error("Задача удалена или недоступна.");

    const isAuthor = isUserAuthorOfTask(task);
    const isExecutor = isUserExecutorOfTask(task);
    const canEdit = isAuthor || isExecutor;
    const title = isAuthor ? "Редактировать задачу" : isExecutor ? "Ответ на задачу" : "Просмотр задачи";

    dialog = document.createElement("dialog");
    dialog.id = "taskEditDialog";
    dialog.className = "task-create-dialog";
    dialog.setAttribute("aria-labelledby", "taskEditTitle");
    dialog.innerHTML = `<form class="task-create-dialog-panel">
      <div class="task-create-dialog-header"><h3 id="taskEditTitle" class="task-create-dialog-title">${title}</h3>
        <button type="button" class="task-edit-delete" data-field="delete">Удалить задачу</button></div>
      <label class="task-highlight-toggle"><input type="checkbox" data-field="highlight" /> Выделить в таблице</label>
      <div class="task-create-dialog-field"><label for="taskEdit-orderTaskTextInput" class="task-create-dialog-label" data-field="task-label">Задача</label>
        <div data-field="composer">${renderTaskComposerHtml()}</div>
        <input id="taskEdit-taskPhotoGalleryInput" type="file" accept="image/*" multiple hidden />
        <input id="taskEdit-taskPhotoCameraInput" type="file" accept="image/*" capture="environment" hidden />
        <div id="taskEdit-taskPendingAttachments" class="task-pending-attachments" aria-label="Вложения задачи" hidden></div>
      </div>
      <label class="task-create-dialog-field task-order-field-attention" data-field="order-field-block" hidden>
        <span class="task-create-dialog-label"><span data-field="order-field-label"></span> <em class="task-order-field-question">(по этому полю вопрос)</em></span>
        <input class="task-create-dialog-order-field" data-field="order-field-value" />
        <textarea class="task-create-dialog-order-field task-create-dialog-order-field--text" data-field="order-field-text-value" rows="1" hidden></textarea>
        <span class="order-tasks-executors-hint" data-field="order-field-hint" hidden></span>
      </label>
      <div class="task-create-dialog-field"><span class="task-create-dialog-label">Исполнители</span>
        <div id="taskEditExecutors" class="messages-create-group-users order-tasks-executors-list" role="group" aria-label="Исполнители задачи"></div>
        <p class="order-tasks-executors-hint" data-field="hint"></p></div>
      <label class="task-create-dialog-field"><span class="task-create-dialog-label" data-field="reply-label">Ответ</span>
        <textarea class="task-create-dialog-text" data-field="reply" rows="1" aria-label="Ответ исполнителя"></textarea></label>
      <label class="task-highlight-toggle"><input type="checkbox" data-field="completed" /> Задача выполнена</label>
      <p class="task-create-dialog-error" role="alert" data-field="error" hidden></p>
      <div class="task-create-dialog-actions">
        <button type="submit" class="btn-primary task-create-dialog-submit">Сохранить</button>
        <button type="button" class="task-create-dialog-cancel">Закрыть</button>
      </div></form>`;
    document.body.append(dialog);
    const field = (name) => dialog.querySelector(`[data-field="${name}"]`);
    const authorName = displayNameGenitiveByEmail(task.author_login);
    field("task-label").textContent = authorName ? `Задача от ${authorName}` : "Задача";
    const executorNames = visibleTaskExecutorEmails(task.executor_emails)
      .map(displayNameGenitiveByEmail)
      .filter(Boolean);
    field("reply-label").textContent = executorNames.length
      ? `Ответ от ${executorNames.join(", ")}`
      : "Ответ";
    const executors = dialog.querySelector("#taskEditExecutors");
    const form = dialog.querySelector("form");
    form.addEventListener("submit", (event) => event.preventDefault());
    const submit = dialog.querySelector('[type="submit"]');
    const cancel = dialog.querySelector(".task-create-dialog-cancel");
    const text = dialog.querySelector("#taskEdit-orderTaskTextInput");
    if (!text) throw new Error("Поле текста задачи недоступно. Обновите страницу.");
    let saving = false;
    let attachmentBusy = false;
    let orderFieldState = null;

    if (task.order_id != null) {
      const titleEl = dialog.querySelector("#taskEditTitle");
      const orderLink = document.createElement("a");
      orderLink.className = "task-dialog-order-link";
      orderLink.href = buildOrderEditUrl(task.order_id);
      orderLink.dataset.orderId = String(task.order_id);
      orderLink.textContent = buildOrderNumberText(task.order_id);
      orderLink.title = `Редактировать заказ ${orderLink.textContent}`;
      titleEl.replaceChildren(document.createTextNode(`${title} · Заказ № `), orderLink);
      orderLink.addEventListener("click", (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        if (saving || attachmentBusy) return;
        dialog.close();
        void import("./orders.js").then((module) => module.editOrder(task.order_id));
      });
    }

    const lockReadOnlyControls = () => {
      text.readOnly = !isAuthor;
      field("reply").readOnly = !isExecutor;
      field("highlight").disabled = saving || attachmentBusy || !isAuthor || !task.source_order_field;
      field("completed").disabled = saving || attachmentBusy || !isAuthor;
      field("delete").hidden = !isAuthor;
      field("delete").disabled = saving || attachmentBusy || !isAuthor;
      executors.querySelectorAll('input[type="checkbox"]').forEach((input) => {
        input.disabled = saving || attachmentBusy || !isAuthor;
      });
      const orderFieldInput = field("order-field-value");
      if (orderFieldInput) {
        orderFieldInput.disabled = saving || attachmentBusy || !canEdit || !orderFieldState?.editable;
      }
      const orderFieldText = field("order-field-text-value");
      if (orderFieldText) {
        orderFieldText.disabled = saving || attachmentBusy || !canEdit || !orderFieldState?.editable;
      }
      dialog.querySelectorAll(
        '[id^="taskEdit-taskAttach"], #taskEdit-taskPickOrderBtn, [data-remove-photo], [data-remove-order], [data-crop]',
      ).forEach((control) => { control.disabled = true; });
      submit.hidden = !canEdit;
      submit.disabled = saving || attachmentBusy || !canEdit;
      cancel.disabled = saving || attachmentBusy;
    };

    field("delete").addEventListener("click", async () => {
      if (!isAuthor || saving || attachmentBusy) return;
      const errorEl = field("error");
      errorEl.hidden = true;
      saving = true;
      lockReadOnlyControls();
      let deleted = false;
      try {
        const { softDeleteAuthorTask } = await import("./tasks.js");
        deleted = await softDeleteAuthorTask(task.id);
      } catch (error) {
        errorEl.textContent = error?.message || "Не удалось удалить задачу. Попробуйте ещё раз.";
        errorEl.hidden = false;
      } finally {
        saving = false;
        lockReadOnlyControls();
      }
      if (deleted) dialog.close();
    });
    const close = () => { if (!saving && !attachmentBusy) dialog.close(); };
    dialog.addEventListener("close", () => { disposeTextResize(); disposeReplyResize(); disposeOrderFieldResize(); composer?.dispose(); dialog.remove(); });
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
    cancel.addEventListener("click", close);
    dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });

    text.rows = 1;
    text.value = task.body || "";
    field("highlight").checked = task.highlight_order_field === true;
    field("completed").checked = [true, 1, "1"].includes(task.is_completed);
    field("reply").value = task.executor_reply || "";
    composer = createTaskAttachmentComposer({
      getElement: (id) => dialog.querySelector(`#taskEdit-${id}`),
      initialAttachments: task.attachments,
      cropHost: dialog,
      onError: (error) => {
        field("error").textContent = error?.message || "Не удалось открыть вложение.";
        field("error").hidden = false;
      },
      onBusyChange: (value) => { attachmentBusy = value; lockReadOnlyControls(); },
    });
    composer.init();

    dialog.showModal();
    disposeTextResize = bindAutogrowTextarea(text);
    disposeReplyResize = bindAutogrowTextarea(field("reply"));
    await ensureTaskExecutorsInList(executors, field("hint"));
    for (const email of visibleTaskExecutorEmails(task.executor_emails)) {
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
    if (task.order_id != null && task.source_order_field) {
      try {
        orderFieldState = await loadTaskOrderField(task.order_id, task.source_order_field);
        if (orderFieldState) {
          field("order-field-block").hidden = false;
          field("order-field-label").textContent = orderFieldState.label;
          const orderFieldInput = field("order-field-value");
          const orderFieldText = field("order-field-text-value");
          const useTextArea = orderFieldState.inputType === "text";
          orderFieldInput.hidden = useTextArea;
          orderFieldText.hidden = !useTextArea;
          if (useTextArea) {
            orderFieldText.rows = 1;
            orderFieldText.value = orderFieldState.value;
            disposeOrderFieldResize = bindAutogrowTextarea(orderFieldText);
          } else {
            orderFieldInput.type = orderFieldState.inputType;
            if (orderFieldState.inputType === "number") orderFieldInput.step = "any";
            orderFieldInput.value = orderFieldState.value;
          }
          if (!orderFieldState.editable) {
            field("order-field-hint").textContent = "Расчётное поле нельзя изменить напрямую.";
            field("order-field-hint").hidden = false;
          }
        }
      } catch (loadError) {
        field("order-field-block").hidden = false;
        field("order-field-label").textContent = "Поле заказа";
        field("order-field-value").hidden = true;
        field("order-field-text-value").hidden = true;
        field("order-field-hint").textContent = loadError?.message || "Не удалось загрузить поле заказа.";
        field("order-field-hint").hidden = false;
      }
    }
    if (!dialog.isConnected) return;
    lockReadOnlyControls();
    if (isAuthor) text.focus();
    else if (isExecutor) field("reply").focus();
    else cancel.focus();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (saving || submit.disabled || !canEdit) return;
      const errorEl = field("error");
      errorEl.hidden = true;
      const patch = {};
      if (isAuthor) {
        const body = text.value.trim();
        if (!body && !composer.hasAttachments()) {
          errorEl.textContent = "Введите текст задачи.";
          errorEl.hidden = false;
          return;
        }
        patch.body = body;
        const selectedExecutors = visibleTaskExecutorEmails(getSelectedExecutorEmailsFrom(executors));
        const previousExecutors = visibleTaskExecutorEmails(task.executor_emails);
        if (JSON.stringify(selectedExecutors) !== JSON.stringify(previousExecutors)) {
          patch.executor_emails = selectedExecutors;
        }
        patch.highlight_order_field = Boolean(task.source_order_field && field("highlight").checked);
        const completed = field("completed").checked;
        if (completed !== [true, 1, "1"].includes(task.is_completed)) patch.is_completed = completed;
      }
      if (isExecutor) {
        const reply = field("reply").value;
        if (reply !== String(task.executor_reply ?? "")) patch.executor_reply = reply;
      }

      saving = true;
      lockReadOnlyControls();
      let saved;
      try {
        if (Object.keys(patch).length) {
          let update = supabaseClient.from("order_tasks").update(patch)
            .eq("id", task.id).is("deleted_at", null);
          if (isAuthor) {
            update = update.eq("author_login", task.author_login);
          } else {
            update = update.eq("executor_reply", String(task.executor_reply ?? ""))
              .contains("executor_emails", [getCurrentUserEmail()]);
          }
          const { data, error: saveError } = await update.select("id").maybeSingle();
          if (saveError) throw saveError;
          if (!data) {
            throw new Error(isExecutor
              ? "Ответ уже изменён или изменился исполнитель. Обновите задачу перед сохранением."
              : "Задача удалена или больше недоступна.");
          }
        }
        if (orderFieldState?.editable) {
          await saveTaskOrderField(
            task.order_id,
            task.source_order_field,
            (orderFieldState.inputType === "text"
              ? field("order-field-text-value")
              : field("order-field-value")).value,
            orderFieldState.value,
          );
        }
        saved = { ...task, ...patch };
      } catch (saveError) {
        errorEl.textContent = saveError?.message || "Не удалось сохранить задачу. Попробуйте ещё раз.";
        errorEl.hidden = false;
      } finally {
        saving = false;
        lockReadOnlyControls();
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
    disposeOrderFieldResize();
    composer?.dispose();
    dialog?.remove();
    throw error;
  } finally {
    opening = false;
  }
}

