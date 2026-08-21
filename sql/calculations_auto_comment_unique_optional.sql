-- =============================================================================
-- ОПЦИОНАЛЬНО: уникальность только для авто-комментариев расчётов.
--
-- Не требуется, чтобы починить «Ошибка при добавлении» на ручных строках.
-- Для бага достаточно DROP INDEX (calculations_dedup_drop_comment_unique.sql
-- или supabase_calculations_dedup_unique_comment.sql).
--
-- Гарантии по данным:
--   ❌ Нет физического DELETE / TRUNCATE / DROP TABLE
--   ✅ Дубликаты авто-строк только мягко скрываются: UPDATE deleted_at = now()
--      (строки остаются в таблице forever)
--   ✅ DROP INDEX / CREATE INDEX — только индексы, не данные
--
-- Авто-комментарии: префиксы [AUTO_ORDER_DELTA] и [AUTO_EXCESS_DELTA].
-- Ручные комментарии этим UNIQUE не затрагиваются.
--
-- Выполнить в Supabase SQL Editor после снятия calculations_comment_uq.
-- Можно повторно.
-- =============================================================================

DROP INDEX IF EXISTS calculations_comment_uq;

-- Мягко скрыть лишние активные авто-дубликаты (оставить rn = 1).
-- Физически строки НЕ удаляются.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY comment ORDER BY id ASC) AS rn
  FROM calculations
  WHERE deleted_at IS NULL
    AND comment IS NOT NULL
    AND (
      comment LIKE '[AUTO_ORDER_DELTA]%'
      OR comment LIKE '[AUTO_EXCESS_DELTA]%'
    )
)
UPDATE calculations c
SET deleted_at = now()
FROM ranked r
WHERE c.id = r.id
  AND r.rn > 1
  AND c.deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS calculations_auto_comment_uq
  ON calculations(comment)
  WHERE deleted_at IS NULL
    AND (
      comment LIKE '[AUTO_ORDER_DELTA]%'
      OR comment LIKE '[AUTO_EXCESS_DELTA]%'
    );
