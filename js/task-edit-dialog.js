import { supabaseClient } from "./config.js";
import { isOfflineDataMode } from "./offline-cache.js";
import {
  isUserAuthorOfTask, ensureTaskExecutorsInList, normalizeExecutorEmails,
  getSelectedExecutorEmailsFrom, datetimeLocalToIso,
} from "./task-form-shared.js";
import { renderTaskAttachmentsHtml, hydrateTaskAttachments } from "./task-attachments.js";

let opening = false;

function localDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export async function openTaskEditDialog(taskId, onSaved) {
  if (opening || document.getElementById("taskEditDialog")) return;
  if (isOfflineDataMode()) throw new Error("Для редактирования задачи подключитесь к интернету.");
  opening = true;
  let dialog;
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
      <label class="task-create-dialog-field"><span class="task-create-dialog-label">Текст</span>
        <textarea class="task-create-dialog-text" rows="4" data-field="body"></textarea></label>
      <div data-field="attachments"></div>
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
    const cancel = dialog.querySelector('[type="button"]');
    let saving = false;
    const close = () => { if (!saving) dialog.close(); };
    dialog.addEventListener("close", () => dialog.remove());
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
    cancel.addEventListener("click", close);
    dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
    field("body").value = task.body || "";
    field("due").value = localDateTime(task.due_at);
    field("attachments").innerHTML = renderTaskAttachmentsHtml(task);
    hydrateTaskAttachments(field("attachments"));
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
    submit.disabled = executors.dataset.loaded !== "1";
    field("body").focus();
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (saving || submit.disabled) return;
      const errorEl = field("error");
      errorEl.hidden = true;
      const body = field("body").value.trim();
      if (!body && !task.attachments?.length) {
        errorEl.textContent = "Введите текст задачи.";
        errorEl.hidden = false;
        return;
      }
      saving = true;
      form.querySelectorAll("input, textarea, button").forEach((el) => { el.disabled = true; });
      let saved;
      try {
        if (isOfflineDataMode()) throw new Error("Для сохранения подключитесь к интернету.");
        if (!isUserAuthorOfTask(task)) throw new Error("Редактировать можно только свои задачи.");
        const patch = {
          body, executor_emails: getSelectedExecutorEmailsFrom(executors),
          due_at: datetimeLocalToIso(field("due").value),
        };
        // Update only editable fields: photos, order and status stay intact.
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
        form.querySelectorAll("input, textarea, button").forEach((el) => { el.disabled = false; });
      }
      if (saved) {
        dialog.close();
        try { await onSaved?.(saved); }
        catch (refreshError) { console.error("Задача сохранена, ошибка обновления списка:", refreshError); }
      }
    });
  } catch (error) {
    dialog?.remove();
    throw error;
  } finally {
    opening = false;
  }
}
