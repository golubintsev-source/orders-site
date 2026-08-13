-- Список редакторов (имя и отчество) в настройках приложения.
-- Значение — JSON-массив строк, например: ["Иван Петрович","Сергей Иванович"]
INSERT INTO app_settings (key, value) VALUES ('editors', '[]')
  ON CONFLICT (key) DO NOTHING;
