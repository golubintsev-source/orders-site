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

-- Если в базе уже успели появиться дубликаты по save_idempotency_key
-- (например, до применения уникальности), то сначала зачистим их,
-- иначе CREATE UNIQUE INDEX упадёт.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY save_idempotency_key ORDER BY id ASC) AS rn
  FROM orders
  WHERE save_idempotency_key IS NOT NULL
)
DELETE FROM orders o
USING ranked r
WHERE o.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS orders_save_idempotency_key_uq
  ON orders(save_idempotency_key)
  WHERE save_idempotency_key IS NOT NULL;

