-- Флаг «закрыть редактирование для user_lite» у заказа. Выполнить в Supabase SQL Editor.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS lock_edit_for_user_lite smallint NOT NULL DEFAULT 0;

COMMENT ON COLUMN orders.lock_edit_for_user_lite IS '1 — user_lite не может редактировать заказ';
