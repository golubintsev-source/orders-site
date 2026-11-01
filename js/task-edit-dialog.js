import { supabaseClient } from "./config.js";
import { isOfflineDataMode } from "./offline-cache.js";
import {
  isUserAuthorOfTask, ensureTaskExecutorsInList, normalizeExecutorEmails,
  getSelectedExecutorEmailsFrom, datetimeLocalToIso,
} from "./task-form-shared.js";
import { createTaskAttachmentComposer } from "./task-attachments.js";

let opening = false;

function localDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function renderTaskEditComposerHtml() {
  return `
    <div class="task-composer-row">
      <textarea
        id="taskEdit-orderTaskTextInput"
        class="task-create-dialog-text"
        data-field="body"
        rows="4"
        placeholder="Текст задачи"
        autocomplete="off"
        aria-label="Текст задачи"
      ></textarea>
      <div class="task-attach-wrap">
        <button
          type="button"
          id="taskEdit-taskAttachBtn"
          class="messages-composer-tool-btn"
          title="Вложение"
          aria-label="Вложение"
          aria-haspopup="menu"
          aria-expanded="false"
        >
          <svg class="messages-composer-tool-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M16.5 6.5l-7.8 7.8a2.75 2.75 0 1 0 3.9 3.9l8.2-8.2a4.5 4.5 0 0 0-6.36-6.36l-8.5 8.5a6.25 6.25 0 0 0 8.84 8.84l6.7-6.7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          </svg>
        </button>
        <div id="taskEdit-taskAttachMenu" class="messages-attach-panel" hidden role="menu" aria-label="Вложения">
          <div class="messages-attach-panel-media" role="group" aria-label="Фото">
            <button type="button" id="taskEdit-taskAttachCameraBtn" class="messages-attach-tile" role="menuitem" title="Сделать фото" aria-label="Сделать фото">
              <span class="messages-attach-tile-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 8h3l1.5-2h7L17 8h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/><circle cx="12" cy="14" r="3.2" stroke="currentColor" stroke-width="1.8" fill="none"/></svg></span>
              <span class="messages-attach-tile-label">Камера</span>
            </button>
            <button type="button" id="taskEdit-taskAttachGalleryBtn" class="messages-attach-tile" role="menuitem" title="Выбрать фото" aria-label="Выбрать фото">
              <span class="messages-attach-tile-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/><circle cx="8.5" cy="10" r="1.5" fill="currentColor"/><path d="M21 16l-5.5-5.5L9 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></span>
              <span class="messages-attach-tile-label">Фото</span>
            </button>
          </div>
          <div class="messages-attach-panel-divider" aria-hidden="true"></div>
          <button type="button" id="taskEdit-taskPickOrderBtn" class="messages-attach-order-btn" role="menuitem" title="Вставить заказ" aria-label="Вставить заказ" aria-haspopup="listbox" aria-expanded="false">
            <svg class="messages-attach-order-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h9l3 3v17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/><path d="M15 2v5h5" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/><path d="M7 13h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M7 17h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            <span>Заказ</span>
          </button>
        </div>
      </div>
    </div>
    <ul id="taskEdit-taskComposerSuggestions" class="messages-suggestions messages-suggestions--orders" hidden role="listbox" aria-label="Заказы"></ul>
  `;
}

export async function openTaskEditDialog(taskId, onSaved) {
  if (opening || document.getElementById("taskEditDialog")) return;
  if (isOfflineDataMode()) throw new Error("Для редактирования задачи подключитесь к интернету.");
  opening = true;
  let dialog;
  let composer;
  try {
    const { data: task, error } = await supabaseClient.from("order_tasks")
      .select("id, author_login, body, executor_emails, due_at, attachments")
      .eq("id", taskId).is("deleted_at", null).maybeSingle();
    if (error) throw error;
    if (!task) throw new Error("Задача удалена или недоступна.");
    if (!isUserAuthorOfTask(task)) throw new Error("Редактировать можно только свои задачи.");

    dialog = document.createElement("dialog");
    dialog.id = "taskEditDialog";
    dialog.className = "task-create-dialog";
    dialog.setAttribute("aria-labelledby", "taskEditTitle");
    dialog.innerHTML = `<form class="task-create-dialog-panel">
      <div class="task-create-dialog-header"><h3 id="taskEditTitle" class="task-create-dialog-title">Редактировать задачу</h3></div>
      <div class="task-create-dialog-field"><label for="taskEdit-orderTaskTextInput" class="task-create-dialog-label">Текст</label>
        <div data-field="composer">${renderTaskEditComposerHtml()}</div>
        <input id="taskEdit-taskPhotoGalleryInput" type="file" accept="image/*" multiple hidden />
        <input id="taskEdit-taskPhotoCameraInput" type="file" accept="image/*" capture="environment" hidden />
        <div id="taskEdit-taskPendingAttachments" class="task-pending-attachments" aria-label="Вложения задачи" hidden></div>
      </div>
      <div class="task-create-dialog-field"><span class="task-create-dialog-label">Исполнители</span>
        <div id="taskEditExecutors" class="messages-create-group-users order-tasks-executors-list" role="group" aria-label="Исполнители задачи"></div>
        <p class="order-tasks-executors-hint" data-field="hint"></p></div>
      <label class="task-create-dialog-field"><span class="task-create-dialog-label">Срок выполнения</span>
        <input type="datetime-local" class="order-tasks-due-input task-create-dialog-due" data-field="due" /></label>
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
      submit.disabled = saving || attachmentBusy || !executorsReady;
    };
    const close = () => { if (!saving && !attachmentBusy) dialog.close(); };
    dialog.addEventListener("close", () => { composer?.dispose(); dialog.remove(); });
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
    cancel.addEventListener("click", close);
    dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
    // The editor owns its controls. Do not clone the create form: cloning form
    // controls is unreliable in iPhone standalone/PWA mode.
    const text = dialog.querySelector("#taskEdit-orderTaskTextInput");
    if (!text) throw new Error("Поле текста задачи недоступно. Обновите страницу.");
    text.value = task.body || "";
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
    field("due").value = localDateTime(task.due_at);

    submit.disabled = true;
    dialog.showModal();
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
          due_at: datetimeLocalToIso(field("due").value),
          attachments: await composer.prepare(),
        };
        // Keep the linked source order and completion status intact.
        const { data, error: saveError } = await supabaseClient.from("order_tasks")
          .update(patch).eq("id", task.id).eq("author_login", task.author_login)
          .is("deleted_at", null).select("id").maybeSingle();
        if (saveError) throw saveError;
        if (!data) throw new Error("Задача удалена или больше недоступна.");
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
    composer?.dispose();
    dialog?.remove();
    throw error;
  } finally {
    opening = false;
  }
}
