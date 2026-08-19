import { supabaseClient } from "./config.js";

let usersCache = null;
let usersCachePromise = null;

/** Список пользователей из profiles (id, email, role). */
export async function loadUsersDirectory() {
  if (usersCache) return usersCache;
  if (usersCachePromise) return usersCachePromise;

  usersCachePromise = (async () => {
    const { data, error } = await supabaseClient
      .from("profiles")
      .select("id, email, role")
      .not("email", "is", null)
      .order("email");

    if (error) {
      console.error("Ошибка загрузки списка пользователей:", error);
      usersCache = [];
      return usersCache;
    }

    usersCache = (data || [])
      .map((row) => ({
        id: row.id,
        email: (row.email || "").trim(),
        role: row.role || "",
      }))
      .filter((u) => u.id && u.email);
    return usersCache;
  })();

  return usersCachePromise;
}

export function clearUsersDirectoryCache() {
  usersCache = null;
  usersCachePromise = null;
}

/** Пользователи для выбора исполнителей: текущий пользователь всегда первым в списке. */
export async function loadTaskExecutorPickerUsers(currentUser) {
  const users = await loadUsersDirectory();
  const email = (currentUser?.email || "").trim();
  if (!email) return users;

  const selfKey = email.toLowerCase();
  const selfEntry = {
    id: currentUser.id,
    email,
    role: "",
    isSelf: true,
  };

  const others = users.filter((u) => u.email.toLowerCase() !== selfKey);
  const existingSelf = users.find((u) => u.email.toLowerCase() === selfKey);
  if (existingSelf) {
    return [{ ...existingSelf, isSelf: true }, ...others];
  }
  return [selfEntry, ...others];
}
