-- Компактный текст уведомлений финансового директора.
-- Исходные комментарии в calculations сохраняем для учёта.
CREATE OR REPLACE FUNCTION public.format_finance_director_comment(p_comment text)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_comment text := btrim(coalesce(p_comment, ''));
  v_is_order_delta boolean;
  v_parts text[];
  v_count integer;
  v_address text;
BEGIN
  IF v_comment = '' THEN RETURN '—'; END IF;
  IF v_comment !~ '^\[AUTO_(ORDER|EXCESS)_DELTA\]' THEN RETURN v_comment; END IF;

  v_is_order_delta := v_comment LIKE '[AUTO_ORDER_DELTA]%';
  v_comment := regexp_replace(v_comment, '^\[AUTO_(ORDER|EXCESS)_DELTA\][[:space:]]*', '');
  v_parts := string_to_array(v_comment, ';');
  v_count := cardinality(v_parts);

  -- Четвёртое поле автопроводки заказа — адрес. Районы области сохраняем.
  IF v_is_order_delta AND v_count >= 4 THEN
    SELECT string_agg(btrim(part), ', ' ORDER BY ord)
      INTO v_address
    FROM regexp_split_to_table(v_parts[4], '[[:space:]]*,[[:space:]]*')
      WITH ORDINALITY AS address_part(part, ord)
    WHERE btrim(part) <> ''
      AND btrim(part) !~* '^(г\.?[[:space:]]*Волгоград|Волгоградская[[:space:]]+(обл\.?|область)|(Тракторозаводский|Краснооктябрьский|Дзержинский|Центральный|Ворошиловский|Советский|Кировский|Красноармейский)[[:space:]]+(р-н\.?|район))$';
    v_parts[4] := coalesce(v_address, btrim(v_parts[4]));
  END IF;

  -- Предпоследнее поле автокомментария — время, уже видимое рядом с сообщением.
  IF v_count >= 2 AND btrim(v_parts[v_count - 1]) ~ '^[0-9]{1,2}:[0-9]{2}$' THEN
    v_parts[v_count - 1] := NULL;
  END IF;
  IF v_is_order_delta AND btrim(v_parts[1]) = 'Доход' THEN
    v_parts[1] := NULL;
  END IF;

  RETURN array_to_string(ARRAY(
    SELECT btrim(part) FROM unnest(v_parts) AS parts(part) WHERE part IS NOT NULL
  ), '; ');
END;
$$;

REVOKE ALL ON FUNCTION public.format_finance_director_comment(text) FROM PUBLIC, anon, authenticated;

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
    || public.format_finance_director_comment(NEW.comment);

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

-- Исправляем уже доставленные системные сообщения, не меняя суммы.
UPDATE public.user_messages
SET body = left(body, strpos(body, '[AUTO_ORDER_DELTA]') - 1)
  || public.format_finance_director_comment(
    substr(body, strpos(body, '[AUTO_ORDER_DELTA]'))
  )
WHERE sender_email = 'finance-director@system.local'
  AND strpos(body, '[AUTO_ORDER_DELTA]') > 0;

UPDATE public.user_messages
SET body = left(body, strpos(body, '[AUTO_EXCESS_DELTA]') - 1)
  || public.format_finance_director_comment(
    substr(body, strpos(body, '[AUTO_EXCESS_DELTA]'))
  )
WHERE sender_email = 'finance-director@system.local'
  AND strpos(body, '[AUTO_EXCESS_DELTA]') > 0;
