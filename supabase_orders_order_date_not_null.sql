-- Заполняем пустые order_date текущим временем (исправляем уже существующие записи без даты).
UPDATE orders
SET order_date = now()
WHERE order_date IS NULL;

-- Добавляем DEFAULT now() и NOT NULL на колонку order_date,
-- чтобы в будущем заказы не могли быть сохранены без даты на уровне БД.
ALTER TABLE orders
  ALTER COLUMN order_date SET DEFAULT now(),
  ALTER COLUMN order_date SET NOT NULL;
