export const form = document.getElementById("orderForm");
export const message = document.getElementById("message");
export const messageTop = document.getElementById("messageTop");
export const logoutBtn = document.getElementById("logoutBtn");
export const cancelEditBtn = document.getElementById("cancelEditBtn");
export const submitBtn = document.getElementById("submitBtn");
export const cancelEditBtnTop = document.getElementById("cancelEditBtnTop");
export const submitBtnTop = document.getElementById("submitBtnTop");
export const formTitle = document.getElementById("formTitle");
export const clientSearch = document.getElementById("clientSearch");
export const phoneInput = document.getElementById("phone");
export const attachmentsInput = document.getElementById("attachments");
export const fileUploadText = document.getElementById("fileUploadText");
export const selectFilesBtn = document.getElementById("selectFilesBtn");
export const selectedFiles = document.getElementById("selectedFiles");
export const filesModal = document.getElementById("filesModal");
export const filesModalBody = document.getElementById("filesModalBody");
export const filesModalTitle = document.getElementById("filesModalTitle");
export const closeFilesModal = document.getElementById("closeFilesModal");
export const cellTooltip = document.getElementById("cellTooltip");
export const ordersTable = document.getElementById("ordersTable");

const ORDER_FORM_DATE_INVALID_TEXT = "Дата указана некорректно";

/** Красное сообщение только под обеими кнопками «Сохранить» (#messageTop и #message). */
export function setOrderFormInvalidDateMessage(show) {
  const text = show ? ORDER_FORM_DATE_INVALID_TEXT : "";
  const color = show ? "#d32f2f" : "";
  [messageTop, message].forEach((el) => {
    if (!el) return;
    el.textContent = text;
    el.style.color = color;
  });
}

export function setMessage(text, color) {
  if (message) {
    if (text !== undefined) message.textContent = text;
    if (color !== undefined) message.style.color = color;
  }
  if (messageTop) {
    if (text !== undefined) messageTop.textContent = text;
    if (color !== undefined) messageTop.style.color = color;
  }
}