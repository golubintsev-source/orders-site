-- Поле «координаты» для маршрутного листа: широта и долгота через запятую, например «48.753016, 44.495766».
-- Выполнить в Supabase SQL Editor после деплоя приложения.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coordinates text;

COMMENT ON COLUMN orders.coordinates IS 'Необязательно: координаты для карты/км (формат «широта, долгота»); задаются с маршрутного листа';
