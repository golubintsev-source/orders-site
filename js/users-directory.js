import { supabaseClient } from "./config.js";

let usersCache = null;
let usersCachePromise = null;

/** Список пользователей из profiles (id, email, role). */
export async function loadUsersDirectory() {
  if (usersCache) return usersCache;
  if (usersCachePromise) return usersCachePromise;

  const request = (async () => {
    const { data, error } = await supabaseClient
      .from("profiles")
      .select("id, email, role")
      .not("email", "is", null)
      .order("email");

    if (error) throw error;

    const users = (data || [])
      .map((row) => ({
        id: row.id,
        email: (row.email || "").trim(),
        role: row.role || "",
      }))
      .filter((u) => u.id && u.email);
    if (!users.length) throw new Error("Справочник пользователей вернул пустой список.");
    return users;
  })();

  usersCachePromise = request;
  try {
    const users = await request;
    if (usersCachePromise === request) usersCache = users;
    return users;
  } finally {
    if (usersCachePromise === request) usersCachePromise = null;
  }
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
