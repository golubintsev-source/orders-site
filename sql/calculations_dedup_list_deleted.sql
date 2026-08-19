-- =============================================================================
-- Список строк calculations, скрытых dedup (только если есть PITR / снимок)
--
-- Без бэкапа Supabase используйте:
--   sql/calculations_dedup_recover_without_backup.sql
-- =============================================================================

-- Строки, которые dedup скрыл бы / уже скрыл (soft delete или старый DELETE)
WITH ranked AS (
  SELECT
    id,
    created_at,
    from_place,
    to_place,
    amount,
    comment,
    deleted_at,
    ROW_NUMBER() OVER (PARTITION BY comment ORDER BY id ASC) AS rn,
    COUNT(*) OVER (PARTITION BY comment) AS cnt_in_group
  FROM calculations_before_dedup
  WHERE deleted_at IS NULL
    AND comment IS NOT NULL
)
SELECT
  id AS hidden_id,
  created_at,
  from_place,
  to_place,
  amount,
  comment,
  cnt_in_group AS duplicates_in_group,
  rn AS rank_in_group
FROM ranked
WHERE rn > 1
ORDER BY comment, id;
