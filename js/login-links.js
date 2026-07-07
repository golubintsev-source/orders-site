import { supabaseClient } from "./config.js";
import { isAdmin } from "./roles.js";

export function buildLoginUrl(loginKey) {
  const origin = window.location.origin;
  return `${origin}/login.html?key=${encodeURIComponent(loginKey)}`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function setLoginLinksMessage(text, isError = false) {
  const msg = document.getElementById("loginLinksMessage");
  if (!msg) return;
  msg.textContent = text;
  msg.classList.toggle("login-links-message--error", isError);
}

export async function loadLoginLinksSection() {
  const card = document.getElementById("loginLinksCard");
  if (!card || !isAdmin()) return;
  card.hidden = false;

  const tbody = document.getElementById("loginLinksTableBody");
  if (!tbody) return;

  setLoginLinksMessage("Загрузка…");

  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, email, login_key, role")
    .not("email", "is", null)
    .order("email");

  if (error) {
    setLoginLinksMessage("Не удалось загрузить список пользователей", true);
    return;
  }

  tbody.replaceChildren();
  for (const row of data || []) {
    const email = (row.email || "").trim();
    const key = (row.login_key || "").trim();
    if (!email || !key) continue;

    const url = buildLoginUrl(key);
    const tr = document.createElement("tr");

    const emailTd = document.createElement("td");
    emailTd.textContent = email;

    const urlTd = document.createElement("td");
    urlTd.className = "login-links-url-cell";
    const code = document.createElement("code");
    code.textContent = url;
    urlTd.appendChild(code);

    const actionsTd = document.createElement("td");
    actionsTd.className = "login-links-actions";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "login-links-btn login-links-copy";
    copyBtn.textContent = "Копировать";
    copyBtn.dataset.url = url;

    const regenBtn = document.createElement("button");
    regenBtn.type = "button";
    regenBtn.className = "login-links-btn login-links-regen";
    regenBtn.textContent = "Новая ссылка";
    regenBtn.dataset.userId = row.id;

    actionsTd.append(copyBtn, regenBtn);
    tr.append(emailTd, urlTd, actionsTd);
    tbody.appendChild(tr);
  }

  setLoginLinksMessage("");
}

export function initLoginLinksSection() {
  const card = document.getElementById("loginLinksCard");
  if (!card) return;

  card.addEventListener("click", async (e) => {
    const copyBtn = e.target.closest(".login-links-copy");
    if (copyBtn) {
      const ok = await copyText(copyBtn.dataset.url || "");
      setLoginLinksMessage(ok ? "Скопировано" : "Не удалось скопировать", !ok);
      return;
    }

    const regenBtn = e.target.closest(".login-links-regen");
    if (!regenBtn || !isAdmin()) return;

    const userId = regenBtn.dataset.userId;
    if (!userId) return;

    setLoginLinksMessage("Обновление…");
    const newKey = crypto.randomUUID();
    const { error } = await supabaseClient.from("profiles").update({ login_key: newKey }).eq("id", userId);

    if (error) {
      setLoginLinksMessage(error.message || "Не удалось обновить ссылку", true);
      return;
    }

    await loadLoginLinksSection();
    setLoginLinksMessage("Ссылка обновлена");
  });
}
