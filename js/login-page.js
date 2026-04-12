import { supabaseClient } from "./config.js";

window.login = async function login() {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  const { error } = await supabaseClient.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    document.getElementById("message").innerText = "Ошибка входа";
    return;
  }

  window.location.href = "index.html";
};
