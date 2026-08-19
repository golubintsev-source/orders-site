-- Идемпотентность побочных эффектов: уникальные записи order_history
-- (анти-дубликаты при повторных кликах/таймаутах).

-- Скрипт можно выполнять повторно.

CREATE UNIQUE INDEX IF NOT EXISTS order_history_order_user_comment_uq
  ON order_history(order_id, user_email, comment);

