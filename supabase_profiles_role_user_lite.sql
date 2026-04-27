-- Исправление ошибки: new row violates check constraint "profiles_role_check"
-- Выполните в Supabase → SQL Editor → Run (одним блоком), затем снова сохраните role = user_lite в Table Editor.

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'user', 'user_lite', 'user_shop'));

-- Пример назначения роли по id (опционально, можно править и через UI):
-- UPDATE profiles SET role = 'user_lite' WHERE id = '54783fc1-c476-41c2-bc51-c321d76b509e';

-- RLS: при необходимости добавьте политики для user_lite отдельно (интерфейс сайта не заменяет RLS).
