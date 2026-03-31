-- =============================================================================
-- Поиск нецелых значений в денежных полях (рубли, без копеек)
-- Выполнить в Supabase → SQL Editor (роль postgres / service role при необходимости).
--
-- Один общий отчёт: src | row_id | col | value_now | round | trunc | floor | ceil
--
-- Площадь (area_m2) — не «сумма в рублях»; отдельный запрос в конце файла.
-- =============================================================================

WITH settings_norm AS (
  SELECT
    key,
    replace(replace(replace(trim(value), E'\u00A0', ''), ' ', ''), ',', '.')::numeric AS n
  FROM app_settings
  WHERE key IN (
    'installer_rate_per_m2',
    'balance_adj_dima',
    'balance_adj_vova',
    'balance_adj_kassa',
    'balance_adj_beznal'
  )
    AND trim(value) <> ''
)

SELECT
  'orders' AS src,
  id::text AS row_id,
  'amount' AS col,
  amount AS value_now,
  round(amount) AS round_half_away,
  trunc(amount) AS trunc_toward_zero,
  floor(amount) AS floor_down,
  ceil(amount) AS ceil_up
FROM orders
WHERE amount IS NOT NULL
  AND amount <> round(amount)

UNION ALL

SELECT
  'orders',
  id::text,
  'prepayment',
  prepayment,
  round(prepayment),
  trunc(prepayment),
  floor(prepayment),
  ceil(prepayment)
FROM orders
WHERE prepayment IS NOT NULL
  AND prepayment <> round(prepayment)

UNION ALL

SELECT
  'orders',
  id::text,
  'remaining_amount',
  remaining_amount,
  round(remaining_amount),
  trunc(remaining_amount),
  floor(remaining_amount),
  ceil(remaining_amount)
FROM orders
WHERE remaining_amount IS NOT NULL
  AND remaining_amount <> round(remaining_amount)

UNION ALL

SELECT
  'orders',
  id::text,
  'installer_payment_amount',
  installer_payment_amount,
  round(installer_payment_amount),
  trunc(installer_payment_amount),
  floor(installer_payment_amount),
  ceil(installer_payment_amount)
FROM orders
WHERE installer_payment_amount IS NOT NULL
  AND installer_payment_amount <> round(installer_payment_amount)

UNION ALL

SELECT
  'calculations',
  id::text,
  'amount',
  amount,
  round(amount),
  trunc(amount),
  floor(amount),
  ceil(amount)
FROM calculations
WHERE deleted_at IS NULL
  AND amount IS NOT NULL
  AND amount <> round(amount)

UNION ALL

SELECT
  'app_settings',
  key,
  'value',
  n,
  round(n),
  trunc(n),
  floor(n),
  ceil(n)
FROM settings_norm
WHERE n IS NOT NULL
  AND n <> round(n)

ORDER BY src, col, row_id;

-- ---------- Опционально: площадь м² с дробью (не сумма в рублях) ----------

-- SELECT id, area_m2 AS value_now, round(area_m2) AS round_if_you_ever_need
-- FROM orders
-- WHERE area_m2 IS NOT NULL AND area_m2 <> round(area_m2)
-- ORDER BY id;

-- =============================================================================
-- ОКРУГЛЕНИЕ (типично для рублей): round(x)
--   round  — до ближайшего целого (в PostgreSQL: 0.5 от нуля вверх по модулю)
--   trunc  — к нулю
--   floor  — вниз
--   ceil   — вверх
--
-- Готовый UPDATE с round(): sql/round_noninteger_sums_round.sql
-- =============================================================================
