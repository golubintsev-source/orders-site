-- Идемпотентность побочных эффектов: уникальные записи расчётов в calculations
-- (анти-дубликаты при повторных кликах/таймаутах).

-- Скрипт можно выполнять повторно.

-- comment у расчётов формируется клиентом (включая порядок/детали).
-- Чтобы повторные попытки после таймаутов не создавали ещё одну строку,
-- фиксируем уникальность активных (deleted_at IS NULL) комментариев.
--
-- ВАЖНО: если дубликаты уже есть, CREATE UNIQUE INDEX упадёт.
-- Поэтому сначала удаляем лишние активные строки.

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY comment ORDER BY id ASC) AS rn
  FROM calculations
  WHERE deleted_at IS NULL
    AND comment IS NOT NULL
)
DELETE FROM calculations c
USING ranked r
WHERE c.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS calculations_comment_uq
  ON calculations(comment)
  WHERE deleted_at IS NULL;

