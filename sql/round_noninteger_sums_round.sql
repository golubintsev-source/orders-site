-- =============================================================================
-- ВНИМАНИЕ: выполнять только после просмотра find_noninteger_sums.sql.
-- Округляет денежные суммы до целых рублей через round().
-- Перед фиксацией: выполните в транзакции, проверьте SELECT после UPDATE, затем COMMIT.
-- =============================================================================

BEGIN;

UPDATE orders
SET amount = round(amount)
WHERE amount IS NOT NULL
  AND amount <> round(amount);

UPDATE orders
SET prepayment = round(prepayment)
WHERE prepayment IS NOT NULL
  AND prepayment <> round(prepayment);

UPDATE orders
SET remaining_amount = round(remaining_amount)
WHERE remaining_amount IS NOT NULL
  AND remaining_amount <> round(remaining_amount);

UPDATE orders
SET installer_payment_amount = round(installer_payment_amount)
WHERE installer_payment_amount IS NOT NULL
  AND installer_payment_amount <> round(installer_payment_amount);

UPDATE calculations
SET amount = round(amount)
WHERE deleted_at IS NULL
  AND amount IS NOT NULL
  AND amount <> round(amount);

UPDATE app_settings
SET value = round(
  replace(replace(replace(trim(value), E'\u00A0', ''), ' ', ''), ',', '.')::numeric
)::text
WHERE key IN (
  'installer_rate_per_m2',
  'balance_adj_dima',
  'balance_adj_vova',
  'balance_adj_kassa',
  'balance_adj_beznal'
)
  AND trim(value) <> ''
  AND replace(replace(replace(trim(value), E'\u00A0', ''), ' ', ''), ',', '.')::numeric
      <> round(replace(replace(replace(trim(value), E'\u00A0', ''), ' ', ''), ',', '.')::numeric);

-- Проверьте строки ещё раз, затем:
-- COMMIT;
ROLLBACK;
