-- Системный собеседник и уведомления о новых проводках с участием Димы.
-- Установить в Supabase до публикации клиента. Исторические строки не рассылаются.
BEGIN;

-- Сохраняем ссылочную целостность обычных отправителей; у системного отправителя
-- нет учётной записи auth.users, поэтому для него ссылка остаётся NULL.
ALTER TABLE public.user_messages DROP CONSTRAINT user_messages_sender_id_fkey;
ALTER TABLE public.user_messages ADD COLUMN sender_auth_id uuid
  GENERATED ALWAYS AS (
    CASE WHEN sender_id = 'f1a4c3d2-0b55-4fac-8d20-8c3be97e0f01'::uuid
      THEN NULL ELSE sender_id END
  ) STORED;
ALTER TABLE public.user_messages ADD CONSTRAINT user_messages_sender_auth_id_fkey
  FOREIGN KEY (sender_auth_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.notify_finance_director_on_calculation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_body text;
BEGIN
  IF NEW.deleted_at IS NOT NULL OR
     (btrim(coalesce(NEW.from_place, '')) <> 'Дима' AND
      btrim(coalesce(NEW.to_place, '')) <> 'Дима') THEN
    RETURN NEW;
  END IF;

  v_body := '💼 Новая запись в расчётах: '
    || coalesce(nullif(btrim(NEW.from_place), ''), '—') || ' → '
    || coalesce(nullif(btrim(NEW.to_place), ''), '—')
    || E'\nСумма: ' || coalesce(NEW.amount::text, '—') || ' ₽';
  IF nullif(btrim(NEW.comment), '') IS NOT NULL THEN
    v_body := v_body || E'\nКомментарий: ' || left(btrim(NEW.comment), 1000);
  END IF;
  IF NEW.order_id IS NOT NULL THEN
    v_body := v_body || E'\nЗаказ: [[order:' || NEW.order_id::text || ']]';
  END IF;

  INSERT INTO public.user_messages
    (sender_id, sender_email, recipient_id, recipient_email, body)
  SELECT 'f1a4c3d2-0b55-4fac-8d20-8c3be97e0f01'::uuid,
    'finance-director@system.local', u.id, u.email, v_body
  FROM auth.users AS u
  WHERE lower(u.email) IN ('golubintsev26@gmail.com',
                           'golubintsev@gmail.com', 'lexa@mail.ru');

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_finance_director_on_calculation() FROM PUBLIC;

CREATE TRIGGER calculations_finance_director_message
AFTER INSERT ON public.calculations
FOR EACH ROW EXECUTE FUNCTION public.notify_finance_director_on_calculation();

COMMIT;
