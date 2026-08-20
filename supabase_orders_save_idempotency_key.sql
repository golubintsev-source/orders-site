-- Идемпотентный ключ для создания заказов (анти-дубликаты)
-- Фикс: при сетевых таймаутах клиент может повторно нажать "Сохранить" и создать
-- второй заказ, хотя первый уже появился в базе.
--
-- Приложение записывает в orders.save_idempotency_key ключ на каждую "сессию формы"
-- и повторно использует его при повторных кликах через upsert
-- (onConflict: "save_idempotency_key").
--
-- ВАЖНО: индекс должен быть ПОЛНЫМ unique-индексом (без WHERE).
-- Частичный индекс `WHERE save_idempotency_key IS NOT NULL` НЕ подходит для
-- PostgreSQL ON CONFLICT (колонка), который генерирует PostgREST/Supabase —
-- иначе ошибка: "there is no unique or exclusion constraint matching the ON CONFLICT specification".
-- Несколько NULL в UNIQUE-колонке в PostgreSQL и так разрешены.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS save_idempotency_key text;

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

-- Убираем старый частичный индекс (если был), иначе IF NOT EXISTS оставит его.
DROP INDEX IF EXISTS orders_save_idempotency_key_uq;

CREATE UNIQUE INDEX orders_save_idempotency_key_uq
  ON orders(save_idempotency_key);
