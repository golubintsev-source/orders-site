-- Ограничить шутки финансового директора одним сообщением за скользящие 72 часа.
-- Остальная логика check_finance_director_joke() остаётся без изменений.
BEGIN;

ALTER TABLE public.finance_director_daily_jokes
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;

-- Для уже отправленных сообщений восстанавливаем максимально точное время.
-- Если сообщения нет (например, строка была добавлена старым бэкфиллом), используем
-- начало соответствующего московского дня: этого достаточно для безопасного лимита.
UPDATE public.finance_director_daily_jokes j
SET sent_at = COALESCE(
  (
    SELECT max(m.created_at)
    FROM public.user_messages m
    WHERE m.recipient_id = j.recipient_id
      AND m.sender_email = 'finance-director@system.local'
      AND (m.created_at AT TIME ZONE 'Europe/Moscow')::date = j.local_day
      AND m.body NOT LIKE 'Приход:%'
      AND m.body NOT LIKE 'Расход:%'
  ),
  j.local_day::timestamp AT TIME ZONE 'Europe/Moscow'
)
WHERE j.sent_at IS NULL;

ALTER TABLE public.finance_director_daily_jokes
  ALTER COLUMN sent_at SET DEFAULT clock_timestamp(),
  ALTER COLUMN sent_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS finance_director_daily_jokes_recipient_sent_at_idx
  ON public.finance_director_daily_jokes (recipient_id, sent_at DESC);

CREATE OR REPLACE FUNCTION public.enforce_finance_director_joke_interval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Сериализуем проверки одного адресата, чтобы две вкладки не отправили две шутки.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.recipient_id::text, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.finance_director_daily_jokes previous_joke
    WHERE previous_joke.recipient_id = NEW.recipient_id
      AND previous_joke.sent_at > pg_catalog.clock_timestamp() - interval '72 hours'
  ) THEN
    RETURN NULL;
  END IF;

  NEW.sent_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finance_director_joke_interval
  ON public.finance_director_daily_jokes;
CREATE TRIGGER finance_director_joke_interval
BEFORE INSERT ON public.finance_director_daily_jokes
FOR EACH ROW EXECUTE FUNCTION public.enforce_finance_director_joke_interval();

REVOKE ALL ON FUNCTION public.enforce_finance_director_joke_interval() FROM PUBLIC;

COMMIT;
