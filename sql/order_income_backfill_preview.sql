-- Только чтение. Показывает заказы, у которых сумма в полях заказа
-- отличается от чистого поступления в основной таблице «Расчеты».
-- Не выполнять INSERT автоматически: старые возвраты и смены получателя
-- требуют сверки, чтобы не продублировать проводки.
WITH income AS (
  SELECT order_id,
    COALESCE(sum(CASE
      WHEN from_place = 'Клиент' AND to_place IN ('Дима', 'Вова', 'Безнал', 'Касса') THEN amount
      WHEN to_place = 'Клиент' AND from_place IN ('Дима', 'Вова', 'Безнал', 'Касса') THEN -amount
      ELSE 0 END), 0) AS linked_income
  FROM public.calculations WHERE deleted_at IS NULL AND order_id IS NOT NULL
  GROUP BY order_id
), comparison AS (
  SELECT o.id AS order_id, o.amount AS cost, o.prepayment, o.prepayment_to,
    o.remaining_amount, o.remaining_to,
    COALESCE(i.linked_income, 0) AS linked_income,
    COALESCE(o.prepayment, 0) +
      CASE WHEN NULLIF(trim(COALESCE(o.remaining_to, '')), '') IS NOT NULL
        THEN COALESCE(o.remaining_amount, 0) ELSE 0 END AS recorded_income
  FROM public.orders o LEFT JOIN income i ON i.order_id = o.id
  WHERE o.deleted_at IS NULL
)
SELECT *, recorded_income - linked_income AS difference
FROM comparison WHERE recorded_income <> linked_income
ORDER BY abs(recorded_income - linked_income) DESC, order_id;
