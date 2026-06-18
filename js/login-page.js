import { supabaseClient } from "./config.js";
import { hrefToHome } from "./app-routes.js";
import { flushPendingAccessLogs, logSiteAccess } from "./access-log.js";

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

  const { data: sessionData } = await supabaseClient.auth.getSession();
  const user = sessionData?.session?.user;
  if (user) {
    await flushPendingAccessLogs(user);
  }

  window.location.href = hrefToHome();
};

void logSiteAccess({ force: true });

const passwordInput = document.getElementById("password");
if (passwordInput) {
  passwordInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      window.login();
    }
  });
}
