/** Короткие имена для push; держать в синхроне с js/user-names.js. */
const EMAIL_DISPLAY_NAMES = {
  "alenushka191179@gmail.com": "Лена",
  "aver1978aver@gmail.com": "Вова",
  "fabrikaokon2019@mail.ru": "Андрей",
  "lary_7812@mail.ru": "Кристина",
  "golubintsev@gmail.com": "Алексей",
  "golubintsev26@gmail.com": "Дима",
  "lexa@mail.ru": "Алексей",
  "animashka89": "Маша",
  "animashka89@gmail.com": "Маша",
  "animashka89@mail.ru": "Маша",
};

function localPart(emailKey) {
  const local = String(emailKey || "").split("@")[0] || "";
  return local.includes("@") ? "" : local;
}

function displayNameByEmail(email) {
  const key = String(email || "").trim().toLowerCase();
  if (!key) return "";
  if (EMAIL_DISPLAY_NAMES[key]) return EMAIL_DISPLAY_NAMES[key];
  const local = localPart(key);
  if (local && EMAIL_DISPLAY_NAMES[local]) return EMAIL_DISPLAY_NAMES[local];
  return local;
}

module.exports = { displayNameByEmail };
