-- Идемпотентный ключ для создания заказов (анти-дубликаты)
-- Фикс: при сетевых таймаутах клиент может повторно нажать "Сохранить" и создать
-- второй заказ, хотя первый уже появился в базе.
--
-- Приложение записывает в orders.save_idempotency_key ключ на каждую "сессию формы"
-- и повторно использует его при повторных кликах.
--
-- Требование: **никаких DELETE из базы**. Поэтому вместо уникального индекса
-- (который не создастся, если дубликаты уже существуют) используем триггер,
-- который запрещает появление *новых* дублей по save_idempotency_key.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS save_idempotency_key text;

-- Триггер: если save_idempotency_key уже существует (хотя бы одна строка),
-- то вставка/обновление ключа отклоняется ошибкой 23505 (unique_violation).
-- Чтобы убрать гонки при конкурентных запросах, используем pg_advisory_xact_lock.

CREATE OR REPLACE FUNCTION orders_prevent_duplicate_save_idempotency_key()
RETURNS trigger AS $$
BEGIN
  IF NEW.save_idempotency_key IS NULL THEN
    RETURN NEW;
  END IF;

  -- Сериализация операций по одному и тому же ключу в рамках транзакций.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.save_idempotency_key));

  -- Для UPDATE исключаем текущую строку (если id уже существует).
  IF EXISTS (
    SELECT 1
    FROM orders o
    WHERE o.save_idempotency_key = NEW.save_idempotency_key
      AND (TG_OP <> 'UPDATE' OR o.id <> NEW.id)
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Duplicate save_idempotency_key'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_prevent_duplicate_save_idempotency_key_trg ON orders;

CREATE TRIGGER orders_prevent_duplicate_save_idempotency_key_trg
BEFORE INSERT OR UPDATE OF save_idempotency_key
ON orders
FOR EACH ROW
EXECUTE FUNCTION orders_prevent_duplicate_save_idempotency_key();
