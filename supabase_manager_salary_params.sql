-- Параметры формулы зарплаты менеджера (фиксированная сумма + процент от стоимости).
-- Таблица app_settings уже существует (см. supabase_settings_table.sql); отдельная миграция схемы не нужна.
-- Ключи:
--   manager_salary_kristina_base     — фиксированная сумма Кристины, целые рубли
--   manager_salary_kristina_percent  — процент Кристины от стоимости, 0…100
--   manager_salary_andrey_base       — фиксированная сумма Андрея, целые рубли
--   manager_salary_andrey_percent    — процент Андрея от стоимости, 0…100
--
-- Значения используются на странице «Зарплата менеджера» при выборе Кристины или Андрея:
--   Зарплата = фиксированная сумма + Стоимость × процент%
--
-- Выполнить в Supabase SQL Editor, если ключей ещё нет.

INSERT INTO app_settings (key, value) VALUES
  ('manager_salary_kristina_base', '22000'),
  ('manager_salary_kristina_percent', '1.5'),
  ('manager_salary_andrey_base', '22000'),
  ('manager_salary_andrey_percent', '1.5')
ON CONFLICT (key) DO NOTHING;
