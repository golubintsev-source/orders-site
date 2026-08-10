/** Отображаемые имена пользователей по email (регистр в адресе не важен). */
const EMAIL_DISPLAY_NAMES = {
  "alenushka191179@gmail.com": "Лена",
  "aver1978aver@gmail.com": "Вова",
  "fabrikaokon2019@mail.ru": "Андрей",
  "lary_7812@mail.ru": "Кристина",
  "golubintsev@gmail.com": "Алексей",
  "golubintsev26@gmail.com": "Дима",
  "lexa@mail.ru": "Алексей",
};

/** Логотипы по ролям: бухгалтер, производство, продажи, разработчик, менеджер, металл. */
const EMAIL_AVATAR_LOGOS = {
  "alenushka191179@gmail.com": "img/avatars/avatar-lena.png",
  "aver1978aver@gmail.com": "img/avatars/avatar-vova.png",
  "fabrikaokon2019@mail.ru": "img/avatars/avatar-andrey.png",
  "lary_7812@mail.ru": "img/avatars/avatar-kristina.png",
  "golubintsev@gmail.com": "img/avatars/avatar-alexey.png",
  "golubintsev26@gmail.com": "img/avatars/avatar-dima.png",
};

const NAME_AVATAR_LOGOS = {
  Лена: "img/avatars/avatar-lena.png",
  Вова: "img/avatars/avatar-vova.png",
  Андрей: "img/avatars/avatar-andrey.png",
  Кристина: "img/avatars/avatar-kristina.png",
  Алексей: "img/avatars/avatar-alexey.png",
  Дима: "img/avatars/avatar-dima.png",
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

/** URL логотипа участника по email или отображаемому имени; иначе null. */
export function avatarLogoUrl({ email, name } = {}) {
  const byEmail = EMAIL_AVATAR_LOGOS[normalizeEmail(email)];
  if (byEmail) return byEmail;
  const byName = NAME_AVATAR_LOGOS[String(name || "").trim()];
  return byName || null;
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
