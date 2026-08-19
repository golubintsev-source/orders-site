-- Идемпотентный ключ для создания заказов (анти-дубликаты)
-- Фикс: при сетевых таймаутах клиент может повторно нажать "Сохранить" и создать
-- второй заказ, хотя первый уже появился в базе.
--
-- Приложение записывает в orders.save_idempotency_key ключ на каждую "сессию формы"
-- и повторно использует его при повторных кликах.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS save_idempotency_key text;

-- Гарантируем, что один и тот же ключ не создаст более одного заказа.
-- (unique index по частичному условию позволяет оставлять save_idempotency_key = null.)
CREATE UNIQUE INDEX IF NOT EXISTS orders_save_idempotency_key_uq
  ON orders(save_idempotency_key)
  WHERE save_idempotency_key IS NOT NULL;

