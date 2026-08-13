-- Добавить поле «Монтажник» (кто выполняет монтаж) в таблицу заказов.
-- Выполнить в Supabase SQL Editor.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS installer_name text;
