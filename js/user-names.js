/** Отображаемые имена пользователей по email (регистр в адресе не важен). */
const EMAIL_DISPLAY_NAMES = {
  "alenushka191179@gmail.com": "Лена",
  "aver1978aver@gmail.com": "Вова",
  "fabrikaokon2019@mail.ru": "Андрей",
  "lary_7812@mail.ru": "Кристина",
  "golubintsev@gmail.com": "Алексей",
  "golubintsev26@gmail.com": "Дима",
};

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/** Имя для интерфейса; для неизвестного email — часть до @. */
export function displayNameByEmail(email) {
  const key = normalizeEmail(email);
  if (!key) return "";
  if (EMAIL_DISPLAY_NAMES[key]) return EMAIL_DISPLAY_NAMES[key];
  return key.split("@")[0] || key;
}

/** Короткая подпись автора в комментариях и расчётах. */
export function shortLoginByEmail(email) {
  const name = displayNameByEmail(email);
  return name || "неизв..";
}

/** Имя вошедшего пользователя в шапке (#topbarUserName). */
export function updateTopbarUserName(email) {
  const el = document.getElementById("topbarUserName");
  if (!el) return;
  const name = displayNameByEmail(email);
  el.textContent = name;
  el.title = name ? `Вошли как ${name}` : "";
}
