export function renderTaskComposerHtml(prefix = "taskEdit-", textInputId = `${prefix}orderTaskTextInput`, attachLabel = "") {
  return `
    <div class="task-composer-row">
      <textarea
        id="taskEdit-orderTaskTextInput"
        class="task-create-dialog-text task-create-dialog-text--autogrow"
        data-field="body"
        rows="1"
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
          </svg>${attachLabel ? `<span>${attachLabel}</span>` : ""}
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
  `.replaceAll("taskEdit-", prefix).replace(`id="${prefix}orderTaskTextInput"`, `id="${textInputId}"`);
}

