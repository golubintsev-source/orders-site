import { bindAutogrowTextarea } from "./autogrow-textarea.js";
import { supabaseClient } from "./config.js";
import { getCurrentUserEmail, isUserExecutorOfTask } from "./task-form-shared.js";
import { isOfflineDataMode, updatePendingTaskReply } from "./offline-cache.js";

const drafts = new Map();
const replySizing = new Map();
const escape = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function replyIsDirty(value, saved) {
  return String(value ?? "") !== String(saved ?? "");
}

export async function saveExecutorReply(row, value, previous) {
  if (!isUserExecutorOfTask(row)) return { ok: false, message: "Сохранить ответ может только исполнитель задачи." };
  const reply = String(value ?? "");
  if (row.__offlineLocalId) {
    const ok = updatePendingTaskReply(row.__offlineLocalId, reply);
    return ok ? { ok: true, reply } : { ok: false, message: "Задача уже синхронизирована. Обновите список и повторите сохранение." };
  }
  if (isOfflineDataMode()) return { ok: false, message: "Для сохранения ответа подключитесь к интернету. Введённый текст сохранён в поле." };
  try {
    const { data, error } = await supabaseClient.from("order_tasks")
      .update({ executor_reply: reply }).eq("id", row.id)
      .contains("executor_emails", [getCurrentUserEmail()])
      .eq("executor_reply", String(previous ?? "")).is("deleted_at", null)
      .select("id, executor_reply").maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, message: "Ответ уже изменён, задача удалена или изменился исполнитель. Обновите список; введённый текст остаётся в поле." };
    return { ok: true, reply: data.executor_reply };
  } catch {
    return { ok: false, message: "Не удалось сохранить ответ. Попробуйте ещё раз." };
  }
}

export function renderTaskReplyCell(row) {
  if (!isUserExecutorOfTask(row)) return `<td class="task-reply-cell">${escape(row.executor_reply)}</td>`;
  const key = `${getCurrentUserEmail()}:${row.__offlineLocalId || row.id}`;
  const saved = String(row.executor_reply ?? "");
  let draft = drafts.get(key);
  if (!draft || (!draft.saving && !replyIsDirty(draft.value, draft.saved))) {
    draft = { value: saved, saved, saving: false, error: "", row };
    drafts.set(key, draft);
  } else {
    draft.row = row;
  }
  const disabled = draft.saving || !replyIsDirty(draft.value, draft.saved);
  return `<td class="task-reply-cell"><div class="task-reply-editor" data-reply-key="${escape(key)}">
    <div class="task-reply-controls">
      <textarea class="task-reply-input" rows="1" aria-label="Ответ по задаче" ${draft.saving ? "disabled" : ""}>${escape(draft.value)}</textarea>
      <button type="button" class="task-reply-save" title="Сохранить ответ" aria-label="Сохранить ответ" ${disabled ? "disabled" : ""}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4 10-10"/></svg>
      </button>
    </div><p class="task-reply-message" role="status" ${draft.error ? "" : "hidden"}>${escape(draft.error)}</p>
  </div></td>`;
}

export function resizeTaskReplyFields(root) {
  for (const [field, dispose] of replySizing) {
    if (!field.isConnected) { dispose(); replySizing.delete(field); }
  }
  for (const field of root?.querySelectorAll(".task-reply-input") || []) {
    if (!replySizing.has(field)) replySizing.set(field, bindAutogrowTextarea(field));
  }
}

export function bindTaskReplyControls(root) {
  if (!root || root.dataset.taskReplyBound) return;
  root.dataset.taskReplyBound = "1";
  function sync(editor, draft) {
    const input = editor.querySelector(".task-reply-input");
    const button = editor.querySelector(".task-reply-save");
    const message = editor.querySelector(".task-reply-message");
    input.disabled = draft.saving;
    button.disabled = draft.saving || !replyIsDirty(draft.value, draft.saved);
    message.textContent = draft.error;
    message.hidden = !draft.error;
  }
  root.addEventListener("input", event => {
    if (!event.target.matches(".task-reply-input")) return;
    const editor = event.target.closest(".task-reply-editor");
    const draft = drafts.get(editor?.dataset.replyKey);
    if (!draft || draft.saving) return;
    draft.value = event.target.value;
    draft.error = "";
    sync(editor, draft);
  });
  root.addEventListener("click", async event => {
    const button = event.target.closest(".task-reply-save");
    if (!button || !root.contains(button) || button.disabled) return;
    event.preventDefault();
    const editor = button.closest(".task-reply-editor");
    const key = editor.dataset.replyKey;
    const draft = drafts.get(key);
    if (!draft || draft.saving || !replyIsDirty(draft.value, draft.saved)) return;
    draft.saving = true;
    draft.error = "";
    sync(editor, draft);
    const result = await saveExecutorReply(draft.row, draft.value, draft.saved);
    draft.saving = false;
    if (result.ok) {
      draft.saved = result.reply;
      draft.row.executor_reply = result.reply;
    } else {
      draft.error = result.message;
    }
    // Completion changes may have re-rendered the table while the save was running.
    for (const current of root.querySelectorAll(".task-reply-editor")) {
      if (current.dataset.replyKey === key) sync(current, draft);
    }
  });
}
