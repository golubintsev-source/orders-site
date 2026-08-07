-- Телефоны заказов: только префикс 8 (+7 и ведущая 7 заменяются на 8).
-- Выполнить в Supabase → SQL Editor после деплоя приложения.

-- +7… → 8…
UPDATE orders
SET phone = regexp_replace(phone, '^\+7', '8')
WHERE phone IS NOT NULL
  AND phone ~ '^\+7';

-- Ведущая 7 (без плюса), если это код страны, а не часть другого формата с 8
UPDATE orders
SET phone = regexp_replace(phone, '^7', '8')
WHERE phone IS NOT NULL
  AND phone ~ '^7'
  AND phone !~ '^8';
