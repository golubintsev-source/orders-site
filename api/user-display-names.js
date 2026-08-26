/** Короткие имена для push; держать в синхроне с js/user-names.js. */
const EMAIL_DISPLAY_NAMES = {
  "alenushka191179@gmail.com": "Лена",
  "aver1978aver@gmail.com": "Вова",
  "fabrikaokon2019@mail.ru": "Андрей",
  "lary_7812@mail.ru": "Кристина",
  "golubintsev@gmail.com": "Алексей",
  "golubintsev26@gmail.com": "Дима",
  "lexa@mail.ru": "Алексей",
};

function displayNameByEmail(email) {
  const key = String(email || "").trim().toLowerCase();
  if (!key) return "";
  if (EMAIL_DISPLAY_NAMES[key]) return EMAIL_DISPLAY_NAMES[key];
  const local = key.split("@")[0] || "";
  return local.includes("@") ? "" : local;
}

module.exports = { displayNameByEmail };
