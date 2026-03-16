-- Добавить поля "Оплата монтажнику" и "Кто оплатил монтажнику" в таблицу заказов. Выполнить в Supabase SQL Editor.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS installer_payment_amount numeric;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS installer_payment_by text;
