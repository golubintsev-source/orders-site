-- Идемпотентность побочных эффектов: уникальные записи расчётов в calculations
-- (анти-дубликаты при повторных кликах/таймаутах).
--
-- ⚠️  ВАЖНО: в приложении расчёты НИКОГДА не удаляются физически — только deleted_at
-- (см. softDeleteCalculationRow в js/calculations.js). Этот скрипт тоже только
-- помечает дубликаты, не DELETE.
--
-- Скрипт можно выполнять повторно.
--
-- comment у расчётов формируется клиентом (включая порядок/детали).
-- Чтобы повторные попытки после таймаутов не создавали ещё одну строку,
-- фиксируем уникальность активных (deleted_at IS NULL) комментариев.
--
-- ВАЖНО: если дубликаты уже есть, CREATE UNIQUE INDEX упадёт.
-- Поэтому сначала мягко скрываем лишние активные строки (оставляем rn = 1).

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY comment ORDER BY id ASC) AS rn
  FROM calculations
  WHERE deleted_at IS NULL
    AND comment IS NOT NULL
)
UPDATE calculations c
SET deleted_at = now()
FROM ranked r
WHERE c.id = r.id
  AND r.rn > 1
  AND c.deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS calculations_comment_uq
  ON calculations(comment)
  WHERE deleted_at IS NULL;
