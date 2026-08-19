-- =============================================================================
-- Список строк calculations, удалённых скриптом supabase_calculations_dedup_unique_comment.sql
--
-- Скрипт dedup физически DELETE-ит строки с rn > 1 в группах одинакового comment
-- (оставляет строку с минимальным id).
--
-- После DELETE восстановить список из «живой» БД нельзя — нужен снимок ДО dedup.
-- Варианты снимка:
--   A) Supabase → Database → Backups → Point in Time Recovery (PITR)
--      на момент ДО запуска dedup (например 2026-08-19 17:30:00+03).
--   B) Экспорт таблицы calculations, если сохраняли вручную.
--
-- Шаг 1. Загрузите снимок во временную таблицу (пример — CSV через Table Editor
--        или INSERT … SELECT из восстановленной ветки PITR):
--
--   CREATE TABLE IF NOT EXISTS calculations_before_dedup (
--     LIKE calculations INCLUDING ALL
--   );
--   -- … импорт данных …
--
-- Шаг 2. Выполните запрос ниже (роль postgres / service role).
-- =============================================================================

-- Строки, которые dedup удалил бы / уже удалил
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
  id AS deleted_id,
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

-- Сводка: сколько строк удалено и суммарный эффект на баланс участников
WITH ranked AS (
  SELECT
    id,
    from_place,
    to_place,
    amount,
    comment,
    ROW_NUMBER() OVER (PARTITION BY comment ORDER BY id ASC) AS rn
  FROM calculations_before_dedup
  WHERE deleted_at IS NULL
    AND comment IS NOT NULL
),
deleted AS (
  SELECT * FROM ranked WHERE rn > 1
),
from_deltas AS (
  SELECT from_place AS participant, -amount AS delta
  FROM deleted
  WHERE from_place IN ('Вова', 'Дима', 'Касса', 'Безнал')
),
to_deltas AS (
  SELECT to_place AS participant, amount AS delta
  FROM deleted
  WHERE to_place IN ('Вова', 'Дима', 'Касса', 'Безнал')
)
SELECT
  participant,
  SUM(delta)::bigint AS net_delta_rubles,
  COUNT(*) AS deleted_rows_touching_participant
FROM (
  SELECT * FROM from_deltas
  UNION ALL
  SELECT * FROM to_deltas
) u
GROUP BY participant
ORDER BY participant;

-- Сравнение: баланс «Сейчас» до dedup vs после (если есть обе таблицы)
-- Участники как в js/balance.js
WITH participants AS (
  SELECT unnest(ARRAY['Вова', 'Дима', 'Касса', 'Безнал']) AS p
),
calc_deltas AS (
  SELECT from_place AS place, -amount AS d, 'before' AS src
  FROM calculations_before_dedup
  WHERE deleted_at IS NULL
  UNION ALL
  SELECT to_place, amount, 'before'
  FROM calculations_before_dedup
  WHERE deleted_at IS NULL
  UNION ALL
  SELECT from_place, -amount, 'after'
  FROM calculations
  WHERE deleted_at IS NULL
  UNION ALL
  SELECT to_place, amount, 'after'
  FROM calculations
  WHERE deleted_at IS NULL
)
SELECT
  p.p AS participant,
  COALESCE(SUM(CASE WHEN src = 'before' AND place = p.p THEN d END), 0)::bigint AS balance_before_dedup,
  COALESCE(SUM(CASE WHEN src = 'after' AND place = p.p THEN d END), 0)::bigint AS balance_now,
  COALESCE(SUM(CASE WHEN src = 'before' AND place = p.p THEN d END), 0)::bigint
    - COALESCE(SUM(CASE WHEN src = 'after' AND place = p.p THEN d END), 0)::bigint AS diff_restore_should_add
FROM participants p
LEFT JOIN calc_deltas c ON c.place = p.p
GROUP BY p.p
ORDER BY p.p;
