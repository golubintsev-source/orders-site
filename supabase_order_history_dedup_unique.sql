-- Идемпотентность побочных эффектов: уникальные записи order_history
-- (анти-дубликаты при повторных кликах/таймаутах).

-- Скрипт можно выполнять повторно.

--
-- ВАЖНО: если дубликаты уже есть, CREATE UNIQUE INDEX упадёт.
-- Поэтому сначала удаляем лишние строки, а затем создаём уникальность.

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY order_id, user_email, comment ORDER BY id ASC) AS rn
  FROM order_history
)
DELETE FROM order_history h
USING ranked r
WHERE h.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS order_history_order_user_comment_uq
  ON order_history(order_id, user_email, comment);

