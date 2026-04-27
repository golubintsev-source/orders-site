import { supabaseClient } from "./config.js";
import { hrefToHome } from "./app-routes.js";

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

  window.location.href = hrefToHome();
};

const passwordInput = document.getElementById("password");
if (passwordInput) {
  passwordInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      window.login();
    }
  });
}
