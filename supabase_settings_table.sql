-- Таблица настроек приложения (ключ-значение). Выполнить в Supabase SQL Editor.
CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value text NOT NULL
);

-- Настройка по умолчанию: стоимость монтажа за 1м² (руб)
INSERT INTO app_settings (key, value) VALUES ('installer_rate_per_m2', '1400')
  ON CONFLICT (key) DO NOTHING;

-- ФИО водителя для маршрутного листа / доставки
INSERT INTO app_settings (key, value) VALUES ('driver_name', '')
  ON CONFLICT (key) DO NOTHING;

-- Имя и отчество редакторов (JSON-массив строк)
INSERT INTO app_settings (key, value) VALUES ('editors', '[]')
  ON CONFLICT (key) DO NOTHING;

-- Корректировки баланса по участникам (целые рубли, могут быть отрицательными)
INSERT INTO app_settings (key, value) VALUES
  ('balance_adj_dima', '0'),
  ('balance_adj_vova', '0'),
  ('balance_adj_kassa', '0'),
  ('balance_adj_beznal', '0')
ON CONFLICT (key) DO NOTHING;

-- RLS: разрешить чтение и обновление для анонимных/авторизованных (подстройте под вашу политику)
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read app_settings" ON app_settings FOR SELECT USING (true);
CREATE POLICY "Allow update app_settings" ON app_settings FOR UPDATE USING (true);
CREATE POLICY "Allow insert app_settings" ON app_settings FOR INSERT WITH CHECK (true);
