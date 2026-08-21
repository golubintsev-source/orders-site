-- Идемпотентность авто-записей в calculations (дельты заказов / излишков).
--
-- ⚠️  Раньше здесь создавался UNIQUE по ВСЕМ comment (calculations_comment_uq).
-- Это ломало ручное добавление на странице «Расчеты»: повторный текст вроде
-- «Протект» у того же автора давал comment «Протект; Лена» и ошибку 23505
-- («Ошибка при добавлении.»). Ручные комментарии не должны быть уникальными.
--
-- Скрипт можно выполнять повторно.
-- 1) Снимаем вредный широкий индекс.
-- 2) Мягко скрываем дубликаты только среди авто-комментариев.
-- 3) Ставим UNIQUE только на авто-строки (префиксы [AUTO_ORDER_DELTA] /
--    [AUTO_EXCESS_DELTA]), чтобы повтор после таймаута не плодил дельты.

-- ⚠️  В приложении расчёты НИКОГДА не удаляются физически — только deleted_at
-- (см. softDeleteCalculationRow в js/calculations.js).

DROP INDEX IF EXISTS calculations_comment_uq;

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
