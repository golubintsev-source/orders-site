/** Первое сохранение нового заказа без фото приостанавливаем; повторное разрешаем. */
export function shouldPauseNewOrderSaveForPhoto({ editingOrderId, hasPhoto, alreadyPrompted }) {
  return editingOrderId == null && !hasPhoto && !alreadyPrompted;
}
