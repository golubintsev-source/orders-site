-- Короткий текст уведомления финансового директора.
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

  v_body := CASE WHEN btrim(coalesce(NEW.to_place, '')) = 'Дима'
    THEN 'Приход: ' ELSE 'Расход: ' END
    || coalesce(NEW.amount::text, '—') || ' ₽, '
    || coalesce(nullif(btrim(NEW.comment), ''), '—');

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
