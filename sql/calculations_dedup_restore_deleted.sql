-- =============================================================================
-- Восстановление строк calculations, удалённых dedup
-- (supabase_calculations_dedup_unique_comment.sql)
--
-- ПРЕДУСЛОВИЕ: таблица calculations_before_dedup — снимок ДО dedup.
-- Список удалённых: sql/calculations_dedup_list_deleted.sql
--
-- Порядок:
--   1) Загрузить снимок → calculations_before_dedup
--   2) calculations_dedup_list_deleted.sql — список и сводка
--   3) Этот файл — INSERT + журнал (идемпотентно)
--   4) calculations_dedup_drop_comment_unique.sql — снять UNIQUE(comment)
--      (только DROP INDEX; строки не трогает)
-- =============================================================================

-- Журнал восстановления (чтобы не вставить дважды при повторном запуске)
CREATE TABLE IF NOT EXISTS calculations_dedup_restore_log (
  original_id bigint PRIMARY KEY,
  restored_calculation_id bigint,
  restored_at timestamptz DEFAULT now() NOT NULL
);

BEGIN;

CREATE TEMP TABLE _calculations_dedup_deleted ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    id,
    created_at,
    from_place,
    to_place,
    amount,
    comment,
    deleted_at,
    ROW_NUMBER() OVER (PARTITION BY comment ORDER BY id ASC) AS rn
  FROM calculations_before_dedup
  WHERE deleted_at IS NULL
    AND comment IS NOT NULL
)
SELECT
  id AS original_id,
  created_at,
  from_place,
  to_place,
  amount,
  comment,
  deleted_at
FROM ranked
WHERE rn > 1;

-- Показать строки, которые ещё не восстановлены
SELECT
  d.original_id,
  d.created_at,
  d.from_place,
  d.to_place,
  d.amount,
  left(d.comment, 120) AS comment_preview
FROM _calculations_dedup_deleted d
LEFT JOIN calculations_dedup_restore_log l ON l.original_id = d.original_id
WHERE l.original_id IS NULL
ORDER BY d.original_id;

-- Вставка по одной строке + журнал (идемпотентно)
DO $$
DECLARE
  r RECORD;
  new_id bigint;
BEGIN
  FOR r IN
    SELECT d.*
    FROM _calculations_dedup_deleted d
    LEFT JOIN calculations_dedup_restore_log l ON l.original_id = d.original_id
    WHERE l.original_id IS NULL
    ORDER BY d.original_id
  LOOP
    INSERT INTO calculations (created_at, from_place, to_place, amount, comment, deleted_at)
    VALUES (r.created_at, r.from_place, r.to_place, r.amount, r.comment, r.deleted_at)
    RETURNING id INTO new_id;

    INSERT INTO calculations_dedup_restore_log (original_id, restored_calculation_id)
    VALUES (r.original_id, new_id);
  END LOOP;
END $$;

COMMIT;

-- Итог
SELECT COUNT(*) AS total_restored_ever FROM calculations_dedup_restore_log;

-- Баланс участников после восстановления (без balanceAdjustments из app_settings)
WITH participants AS (
  SELECT unnest(ARRAY['Вова', 'Дима', 'Касса', 'Безнал']) AS p
),
calc_deltas AS (
  SELECT from_place AS place, -amount AS d FROM calculations WHERE deleted_at IS NULL
  UNION ALL
  SELECT to_place, amount FROM calculations WHERE deleted_at IS NULL
)
SELECT
  p.p AS participant,
  COALESCE(SUM(d), 0)::bigint AS balance_rubles
FROM participants p
LEFT JOIN calc_deltas c ON c.place = p.p
GROUP BY p.p
ORDER BY p.p;
