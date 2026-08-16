import { state } from "./state.js";

/** Допустимые значения profiles.role в Supabase */
export const ALLOWED_ROLES = ["admin", "user", "user_lite", "user_shop"];

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

export function isUserShop() {
  return state.currentRole === "user_shop";
}

/** Тип заказа, недоступный для просмотра и редактирования роли user_lite. */
const ORDER_TYPE_EXCLUDED_FOR_USER_LITE = "Магазин";
const ORDER_TYPE_ONLY_FOR_USER_SHOP = "Магазин";

export function isShopOrder(order) {
  return (order?.order_type || "").trim() === ORDER_TYPE_ONLY_FOR_USER_SHOP;
}

/** Заказ не показывается в таблице и не открывается user_lite (по полю order_type). */
export function isOrderHiddenFromUserLite(order) {
  if (!isUserLite() || !order) return false;
  return (order.order_type || "").trim() === ORDER_TYPE_EXCLUDED_FOR_USER_LITE;
}

/** Заказ не показывается и не открывается для текущей роли. */
export function isOrderHiddenForCurrentRole(order) {
  if (!order) return false;
  if (isUserLite()) return isOrderHiddenFromUserLite(order);
  if (isUserShop()) return !isShopOrder(order);
  return false;
}

/** В БД lock_edit_for_user_lite = 1 — user_lite не может редактировать заказ. */
export function isOrderEditLockedForUserLite(order) {
  if (!order) return false;
  const v = order.lock_edit_for_user_lite;
  return v === true || v === 1 || v === "1";
}

/** Создание и редактирование заявок (форма, сохранение). */
export function canMutateOrders() {
  return isAdmin() || state.currentRole === "user" || isUserLite() || isUserShop();
}

/** Мягкое удаление заявок (поле deleted_at). Доступно админу и роли user, не user_lite. */
export function canDeleteOrders() {
  return isAdmin() || state.currentRole === "user";
}

/** Места «Касса» и «Безнал» в выпадающих списках передачи денег. */
export const KASSA_BEZNAL_PLACES = new Set(["Касса", "Безнал"]);

/** Выбор «Касса» / «Безнал» (кому переданы деньги) — только admin и user. */
export function canSelectKassaBeznal() {
  return isAdmin() || state.currentRole === "user";
}

/** Сохранение выбора чекбоксов на «Зарплата менеджера» — только admin и user. */
export function canSaveManagerSalaryChecks() {
  return isAdmin() || state.currentRole === "user";
}

/** Разделы меню, закрытые для отдельных ролей. Настройки доступны всем (блок уведомлений). */
export function canAccessSection(sectionId) {
  if (isUserShop()) {
    return (
      sectionId !== "balance" &&
      sectionId !== "manager-salary" &&
      sectionId !== "statistics" &&
      sectionId !== "statistics-balance" &&
      sectionId !== "calculations"
    );
  }
  if ((sectionId === "statistics" || sectionId === "statistics-balance") && !isAdmin()) {
    return false;
  }
  if (sectionId === "orders-excel" && isUserLite()) return false;
  if (!isUserLite()) return true;
  // user_lite: просмотр «Зарплата менеджера» разрешён; баланс и расчёты — нет
  return sectionId !== "balance" && sectionId !== "calculations";
}

export function isSectionHiddenFromNav(sectionId) {
  if (sectionId === "order-tasks") return true;
  if (sectionId === "messages") return true;
  if (sectionId === "voice") return true;
  if (isUserShop()) {
    return (
      sectionId === "balance" ||
      sectionId === "manager-salary" ||
      sectionId === "statistics" ||
      sectionId === "statistics-balance" ||
      sectionId === "calculations"
    );
  }
  if ((sectionId === "statistics" || sectionId === "statistics-balance") && !isAdmin()) {
    return true;
  }
  if (sectionId === "orders-excel" && isUserLite()) return true;
  if (!isUserLite()) return false;
  return sectionId === "balance" || sectionId === "calculations";
}
