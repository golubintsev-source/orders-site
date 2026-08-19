-- =============================================================================
-- Восстановление баланса БЕЗ бэкапа Supabase (free tier)
--
-- Контекст: старая версия supabase_calculations_dedup_unique_comment.sql
-- ошибочно делала DELETE вместо soft delete (deleted_at). Строки безвозвратно
-- потеряны, если нет PITR.
--
-- Что можно сделать:
--   1) Взять последний снимок «Сейчас» из site_access_logs (до dedup ~18:27 MSK)
--   2) Сравнить с текущим балансом (calculations + balance_adj_*)
--   3) Вставить корректирующие строки в calculations с пометкой [RESTORE_DEDUP]
--
-- Точный список удалённых id восстановить нельзя — только суммовой эффект.
--
-- Выполнить в Supabase SQL Editor (postgres). Перед INSERT — проверьте SELECT-ы.
-- =============================================================================

-- --- 1. Последние снимки баланса (ищем запись ДО dedup) -------------------
SELECT
  id,
  created_at,
  user_email,
  page_path,
  (regexp_match(page_path, '[?&]d=(-?[0-9]+)'))[1]::bigint AS snapshot_dima,
  (regexp_match(page_path, '[?&]v=(-?[0-9]+)'))[1]::bigint AS snapshot_vova,
  (regexp_match(page_path, '[?&]k=(-?[0-9]+)'))[1]::bigint AS snapshot_kassa,
  (regexp_match(page_path, '[?&]b=(-?[0-9]+)'))[1]::bigint AS snapshot_beznal
FROM site_access_logs
WHERE page_path LIKE '/balance-snapshot%'
ORDER BY created_at DESC
LIMIT 30;

-- --- 2. Подставьте id строки-снимка ДО dedup (из запроса выше) --------------
-- Пример: последняя запись до 2026-08-19 15:27:00+00 (18:27 MSK)
-- \set snapshot_log_id 12345   -- psql; в SQL Editor замените число в CTE ниже

WITH snapshot_row AS (
  SELECT
    (regexp_match(page_path, '[?&]d=(-?[0-9]+)'))[1]::bigint AS dima,
    (regexp_match(page_path, '[?&]v=(-?[0-9]+)'))[1]::bigint AS vova,
    (regexp_match(page_path, '[?&]k=(-?[0-9]+)'))[1]::bigint AS kassa,
    (regexp_match(page_path, '[?&]b=(-?[0-9]+)'))[1]::bigint AS beznal
  FROM site_access_logs
  WHERE page_path LIKE '/balance-snapshot%'
    AND created_at < timestamptz '2026-08-19 15:27:00+00'  -- ← подстройте время dedup
  ORDER BY created_at DESC
  LIMIT 1
),
participants AS (
  SELECT * FROM (VALUES
    ('Дима', 'dima', 'balance_adj_dima'),
    ('Вова', 'vova', 'balance_adj_vova'),
    ('Касса', 'kassa', 'balance_adj_kassa'),
    ('Безнал', 'beznal', 'balance_adj_beznal')
  ) AS t(participant, snap_col, adj_key)
),
calc_net AS (
  SELECT
    p.participant,
    COALESCE(SUM(CASE WHEN c.from_place = p.participant THEN -c.amount END), 0)
    + COALESCE(SUM(CASE WHEN c.to_place = p.participant THEN c.amount END), 0) AS calc_net
  FROM participants p
  LEFT JOIN calculations c ON c.deleted_at IS NULL
    AND (c.from_place = p.participant OR c.to_place = p.participant)
  GROUP BY p.participant
),
adj AS (
  SELECT
    p.participant,
    COALESCE(NULLIF(trim(s.value), ''), '0')::numeric AS adj_amount
  FROM participants p
  LEFT JOIN app_settings s ON s.key = p.adj_key
),
current_balance AS (
  SELECT
    cn.participant,
    trunc(cn.calc_net + COALESCE(a.adj_amount, 0))::bigint AS balance_now
  FROM calc_net cn
  JOIN adj a USING (participant)
),
snapshot_balance AS (
  SELECT 'Дима' AS participant, s.dima AS balance_snapshot FROM snapshot_row s
  UNION ALL SELECT 'Вова', s.vova FROM snapshot_row s
  UNION ALL SELECT 'Касса', s.kassa FROM snapshot_row s
  UNION ALL SELECT 'Безнал', s.beznal FROM snapshot_row s
)
SELECT
  cb.participant,
  sb.balance_snapshot,
  cb.balance_now,
  sb.balance_snapshot - cb.balance_now AS diff_to_restore
FROM current_balance cb
JOIN snapshot_balance sb USING (participant)
ORDER BY cb.participant;

-- --- 3. PREVIEW: какие строки будут вставлены ------------------------------
WITH snapshot_row AS (
  SELECT
    (regexp_match(page_path, '[?&]d=(-?[0-9]+)'))[1]::bigint AS dima,
    (regexp_match(page_path, '[?&]v=(-?[0-9]+)'))[1]::bigint AS vova,
    (regexp_match(page_path, '[?&]k=(-?[0-9]+)'))[1]::bigint AS kassa,
    (regexp_match(page_path, '[?&]b=(-?[0-9]+)'))[1]::bigint AS beznal
  FROM site_access_logs
  WHERE page_path LIKE '/balance-snapshot%'
    AND created_at < timestamptz '2026-08-19 15:27:00+00'
  ORDER BY created_at DESC
  LIMIT 1
),
participants AS (
  SELECT * FROM (VALUES
    ('Дима', 'dima', 'balance_adj_dima'),
    ('Вова', 'vova', 'balance_adj_vova'),
    ('Касса', 'kassa', 'balance_adj_kassa'),
    ('Безнал', 'beznal', 'balance_adj_beznal')
  ) AS t(participant, snap_col, adj_key)
),
calc_net AS (
  SELECT
    p.participant,
    COALESCE(SUM(CASE WHEN c.from_place = p.participant THEN -c.amount END), 0)
    + COALESCE(SUM(CASE WHEN c.to_place = p.participant THEN c.amount END), 0) AS calc_net
  FROM participants p
  LEFT JOIN calculations c ON c.deleted_at IS NULL
    AND (c.from_place = p.participant OR c.to_place = p.participant)
  GROUP BY p.participant
),
adj AS (
  SELECT
    p.participant,
    COALESCE(NULLIF(trim(s.value), ''), '0')::numeric AS adj_amount
  FROM participants p
  LEFT JOIN app_settings s ON s.key = p.adj_key
),
diffs AS (
  SELECT
    p.participant,
    CASE p.participant
      WHEN 'Дима' THEN s.dima
      WHEN 'Вова' THEN s.vova
      WHEN 'Касса' THEN s.kassa
      WHEN 'Безнал' THEN s.beznal
    END - trunc(cn.calc_net + COALESCE(a.adj_amount, 0))::bigint AS diff
  FROM participants p
  CROSS JOIN snapshot_row s
  JOIN calc_net cn ON cn.participant = p.participant
  JOIN adj a ON a.participant = p.participant
)
SELECT
  participant,
  diff,
  CASE WHEN diff > 0 THEN 'Клиент' ELSE participant END AS from_place,
  CASE WHEN diff > 0 THEN participant ELSE 'Клиент' END AS to_place,
  abs(diff) AS amount,
  format(
    '[RESTORE_DEDUP] Восстановление после ошибочного DELETE dedup; %s; delta %+s',
    participant,
    diff
  ) AS comment
FROM diffs
WHERE diff <> 0;

-- --- 4. INSERT (раскомментируйте после проверки preview) -------------------
/*
WITH snapshot_row AS (
  SELECT
    (regexp_match(page_path, '[?&]d=(-?[0-9]+)'))[1]::bigint AS dima,
    (regexp_match(page_path, '[?&]v=(-?[0-9]+)'))[1]::bigint AS vova,
    (regexp_match(page_path, '[?&]k=(-?[0-9]+)'))[1]::bigint AS kassa,
    (regexp_match(page_path, '[?&]b=(-?[0-9]+)'))[1]::bigint AS beznal
  FROM site_access_logs
  WHERE page_path LIKE '/balance-snapshot%'
    AND created_at < timestamptz '2026-08-19 15:27:00+00'
  ORDER BY created_at DESC
  LIMIT 1
),
participants AS (
  SELECT * FROM (VALUES
    ('Дима', 'balance_adj_dima'),
    ('Вова', 'balance_adj_vova'),
    ('Касса', 'balance_adj_kassa'),
    ('Безнал', 'balance_adj_beznal')
  ) AS t(participant, adj_key)
),
calc_net AS (
  SELECT
    p.participant,
    COALESCE(SUM(CASE WHEN c.from_place = p.participant THEN -c.amount END), 0)
    + COALESCE(SUM(CASE WHEN c.to_place = p.participant THEN c.amount END), 0) AS calc_net
  FROM participants p
  LEFT JOIN calculations c ON c.deleted_at IS NULL
    AND (c.from_place = p.participant OR c.to_place = p.participant)
  GROUP BY p.participant
),
adj AS (
  SELECT
    p.participant,
    COALESCE(NULLIF(trim(s.value), ''), '0')::numeric AS adj_amount
  FROM participants p
  LEFT JOIN app_settings s ON s.key = p.adj_key
),
diffs AS (
  SELECT
    p.participant,
    CASE p.participant
      WHEN 'Дима' THEN s.dima
      WHEN 'Вова' THEN s.vova
      WHEN 'Касса' THEN s.kassa
      WHEN 'Безнал' THEN s.beznal
    END - trunc(cn.calc_net + COALESCE(a.adj_amount, 0))::bigint AS diff
  FROM participants p
  CROSS JOIN snapshot_row s
  JOIN calc_net cn ON cn.participant = p.participant
  JOIN adj a ON a.participant = p.participant
),
to_insert AS (
  SELECT
    CASE WHEN diff > 0 THEN 'Клиент' ELSE participant END AS from_place,
    CASE WHEN diff > 0 THEN participant ELSE 'Клиент' END AS to_place,
    abs(diff)::numeric AS amount,
    format(
      '[RESTORE_DEDUP] Восстановление после ошибочного DELETE dedup; %s; delta %+s',
      participant,
      diff
    ) AS comment
  FROM diffs
  WHERE diff <> 0
    AND NOT EXISTS (
      SELECT 1 FROM calculations c
      WHERE c.deleted_at IS NULL
        AND c.comment LIKE '[RESTORE_DEDUP]%' || participant || '%'
        AND c.comment LIKE '%delta ' || diff || '%'
    )
)
INSERT INTO calculations (created_at, from_place, to_place, amount, comment)
SELECT now(), from_place, to_place, amount, comment
FROM to_insert;
*/

-- --- 5. Снять опасный UNIQUE(comment), если ещё не сняли --------------------
-- sql/calculations_dedup_drop_comment_unique.sql
