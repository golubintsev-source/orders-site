-- Заказы, у которых в данных есть остаток и «Кому остаток», но нет авто-строки
-- по остатку в calculations (как в приложении: префикс [AUTO_ORDER_DELTA], блок «Остаток»).
--
-- Важно: в текущем коде автозапись не вставляет order_id в calculations — только comment.
-- Поэтому связь ищется по фрагменту номера в комментарии (как formatOrderIdTypeChip в js/format.js).
--
-- Выполнить в Supabase SQL Editor (при необходимости поправьте имена схемы/полей).

WITH order_chip AS (
  SELECT
    o.id,
    o.remaining_amount,
    o.remaining_to,
    o.order_type,
    o.client,
    o.updated_at,
    -- Аналог String(orderId).padStart(4, '0') — для id >= 10000 строка без доп. нулей слева
    CASE
      WHEN length(trim(o.id::text)) >= 4 THEN trim(o.id::text)
      ELSE lpad(trim(o.id::text), 4, '0')
    END AS base_id,
    CASE
      WHEN trim(COALESCE(o.order_type, '')) <> ''
      THEN
        CASE
          WHEN length(trim(o.id::text)) >= 4 THEN trim(o.id::text)
          ELSE lpad(trim(o.id::text), 4, '0')
        END
        || '_'
        || left(trim(o.order_type), 1)
      ELSE
        CASE
          WHEN length(trim(o.id::text)) >= 4 THEN trim(o.id::text)
          ELSE lpad(trim(o.id::text), 4, '0')
        END
    END AS chip
  FROM orders o
  WHERE o.deleted_at IS NULL
    AND COALESCE(o.remaining_amount, 0) > 0
    AND trim(COALESCE(o.remaining_to, '')) <> ''
)
SELECT
  oc.id AS order_id,
  oc.remaining_amount,
  oc.remaining_to,
  oc.order_type,
  oc.client,
  oc.updated_at
FROM order_chip oc
WHERE NOT EXISTS (
  SELECT 1
  FROM calculations c
  WHERE c.deleted_at IS NULL
    AND c.comment LIKE '[AUTO_ORDER_DELTA]%'
    AND (
      c.comment LIKE '% Остаток;%'
      OR c.comment LIKE '% Остаток (получатель);%'
    )
    -- Фрагмент «; 0101_О;» или «; 0101;» — как в теле комментария после вида движения
    AND (
      c.comment LIKE '%; ' || oc.chip || ';%'
      OR c.comment LIKE '%; ' || oc.base_id || ';%'
    )
)
ORDER BY oc.id DESC;

-- Проверка одного заказа (пример: 101):
-- SELECT id, remaining_amount, remaining_to, order_type FROM orders WHERE id = 101 AND deleted_at IS NULL;
-- SELECT id, created_at, from_place, to_place, amount, left(comment, 120)
-- FROM calculations
-- WHERE deleted_at IS NULL AND comment LIKE '[AUTO_ORDER_DELTA]%Остаток%'
-- ORDER BY created_at DESC;
