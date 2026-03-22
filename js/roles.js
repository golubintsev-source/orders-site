import { state } from "./state.js";

/** Допустимые значения profiles.role в Supabase */
export const ALLOWED_ROLES = ["admin", "user", "user_lite"];

export function normalizeRole(raw) {
  const r = String(raw ?? "").trim();
  if (ALLOWED_ROLES.includes(r)) return r;
  return "user";
}

export function isAdmin() {
  return state.currentRole === "admin";
}

export function isUserLite() {
  return state.currentRole === "user_lite";
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
