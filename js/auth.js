import { supabaseClient } from "./config.js";
import { state } from "./state.js";
import { normalizeRole } from "./roles.js";

export async function checkAuth() {
  const { data, error } = await supabaseClient.auth.getUser();

  if (error || !data.user) {
    window.location.href = "login.html";
    return null;
  }

  state.currentUser = data.user;
  return data.user;
}

export async function loadProfile() {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("role")
    .eq("id", state.currentUser.id)
    .single();

  if (error) {
    console.error("Ошибка загрузки профиля:", error);
    state.currentRole = normalizeRole(null);
    return;
  }

  state.currentRole = normalizeRole(data?.role);
}

export async function logout() {
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
}