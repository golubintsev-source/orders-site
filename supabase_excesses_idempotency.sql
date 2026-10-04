-- Защита от повторного добавления одних и тех же излишков.
-- Скрипт можно запускать повторно. Он не удаляет и не изменяет существующие строки.
-- Старые строки с NULL в save_idempotency_key не мешают установке защиты.

ALTER TABLE public.excesses
  ADD COLUMN IF NOT EXISTS save_idempotency_key text;

CREATE OR REPLACE FUNCTION public.excesses_prevent_duplicate_save_idempotency_key()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.save_idempotency_key IS NULL OR btrim(NEW.save_idempotency_key) = '' THEN
    RETURN NEW;
  END IF;

  -- Одновременные запросы с одним ключом выполняются строго по очереди.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.save_idempotency_key));

  IF EXISTS (
    SELECT 1
      FROM public.excesses e
     WHERE e.save_idempotency_key = NEW.save_idempotency_key
       AND (TG_OP <> 'UPDATE' OR e.id <> NEW.id)
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Duplicate excess save_idempotency_key'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS excesses_prevent_duplicate_save_idempotency_key_trg
  ON public.excesses;

CREATE TRIGGER excesses_prevent_duplicate_save_idempotency_key_trg
BEFORE INSERT OR UPDATE OF save_idempotency_key
ON public.excesses
FOR EACH ROW
EXECUTE FUNCTION public.excesses_prevent_duplicate_save_idempotency_key();

NOTIFY pgrst, 'reload schema';
