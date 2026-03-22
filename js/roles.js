import { state } from "./state.js";

/** Допустимые значения profiles.role в Supabase */
export const ALLOWED_ROLES = ["admin", "user", "user_lite"];

export function normalizeRole(raw) {
  let r = String(raw ?? "").trim();
  if (r === "user_lte") r = "user_lite";
  if (ALLOWED_ROLES.includes(r)) return r;
  return "user";
}

export function isAdmin() {
  return state.currentRole === "admin";
}

export function isUserLite() {
  return state.currentRole === "user_lite";
}

/** Тип заказа, недоступный для просмотра и редактирования роли user_lite. */
const ORDER_TYPE_EXCLUDED_FOR_USER_LITE = "Магазин";

/** Заказ не показывается в таблице и не открывается user_lite (по полю order_type). */
export function isOrderHiddenFromUserLite(order) {
  if (!isUserLite() || !order) return false;
  return (order.order_type || "").trim() === ORDER_TYPE_EXCLUDED_FOR_USER_LITE;
}

/** В БД lock_edit_for_user_lite = 1 — user_lite не может редактировать заказ. */
export function isOrderEditLockedForUserLite(order) {
  if (!order) return false;
  const v = order.lock_edit_for_user_lite;
  return v === true || v === 1 || v === "1";
}

/** Создание и редактирование заявок (форма, сохранение). */
export function canMutateOrders() {
  return isAdmin() || state.currentRole === "user" || isUserLite();
}

/** Разделы меню, закрытые для user_lite. */
export function canAccessSection(sectionId) {
  if (!isUserLite()) return true;
  return (
    sectionId !== "balance" &&
    sectionId !== "settings" &&
    sectionId !== "calculations"
  );
}

export function isSectionHiddenFromNav(sectionId) {
  if (!isUserLite()) return false;
  return sectionId === "balance" || sectionId === "settings" || sectionId === "calculations";
}
