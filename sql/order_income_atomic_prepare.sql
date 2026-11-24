-- Подготовлено для проверки. НЕ применять без отдельного разрешения владельца.
-- До установки функции интерфейс доходов нельзя публиковать.
BEGIN;

CREATE TABLE IF NOT EXISTS public.order_income_requests (
  request_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  order_id bigint NOT NULL REFERENCES public.orders(id),
  calculation_id bigint NOT NULL REFERENCES public.calculations(id),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.order_income_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_income_requests_read_own ON public.order_income_requests
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY order_income_requests_insert_own ON public.order_income_requests
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
REVOKE ALL ON public.order_income_requests FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.order_income_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.add_order_income(
  p_request_id uuid, p_order_id bigint, p_to_place text, p_amount numeric, p_comment text DEFAULT ''
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_role text;
  v_before numeric;
  v_net numeric;
  v_total numeric;
  v_calculation_id bigint;
  v_result jsonb;
  v_existing public.order_income_requests%ROWTYPE;
  v_author text;
  v_address text;
  v_remaining numeric;
BEGIN
  IF auth.uid() IS NULL OR p_request_id IS NULL OR p_order_id IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация и номер заказа' USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> trunc(p_amount) THEN
    RAISE EXCEPTION 'Укажите положительную сумму в целых рублях' USING ERRCODE = '22023';
  END IF;
  IF p_to_place NOT IN ('Дима', 'Вова', 'Безнал', 'Касса') OR p_to_place IS NULL THEN
    RAISE EXCEPTION 'Недоступное направление дохода' USING ERRCODE = '22023';
  END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'user', 'user_lite', 'user_shop') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF v_role = 'user_lite' AND p_to_place NOT IN ('Дима', 'Вова') THEN
    RAISE EXCEPTION 'Эта касса недоступна для вашей роли' USING ERRCODE = '42501';
  END IF;
  IF v_role = 'user_shop' AND p_to_place NOT IN ('Дима', 'Вова') THEN
    RAISE EXCEPTION 'Эта касса недоступна для вашей роли' USING ERRCODE = '42501';
  END IF;

  -- Один и тот же ключ возвращает прежний результат после таймаута сети.
  PERFORM pg_advisory_xact_lock(hashtext(p_request_id::text));
  SELECT * INTO v_existing FROM public.order_income_requests WHERE request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.user_id <> auth.uid() OR v_existing.order_id <> p_order_id THEN
      RAISE EXCEPTION 'Ключ запроса уже использован' USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.result;
  END IF;

  SELECT * INTO v_order FROM public.orders
  WHERE id = p_order_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заказ не найден' USING ERRCODE = 'P0002'; END IF;
  IF (v_role = 'user_lite' AND (v_order.order_type = 'Магазин' OR v_order.lock_edit_for_user_lite = 1))
     OR (v_role = 'user_shop' AND v_order.order_type IS DISTINCT FROM 'Магазин') THEN
    RAISE EXCEPTION 'У вас нет доступа к этому заказу' USING ERRCODE = '42501';
  END IF;
  IF v_order.amount IS NULL OR v_order.amount <= 0 OR v_order.amount <> trunc(v_order.amount) THEN
    RAISE EXCEPTION 'Для внесения дохода нужна стоимость заказа в целых рублях' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(sum(CASE
      WHEN from_place = 'Клиент' AND to_place IN ('Дима', 'Вова', 'Безнал', 'Касса') THEN amount
      WHEN to_place = 'Клиент' AND from_place IN ('Дима', 'Вова', 'Безнал', 'Касса') THEN -amount
      ELSE 0 END), 0)
    INTO v_net FROM public.calculations WHERE order_id = p_order_id AND deleted_at IS NULL;
  -- По старым заказам расхождения с «Расчётами» допустимы: старые строки
  -- не добавляем. Сумму из полей учитываем для защиты от переплаты при
  -- внесении только нового дохода пользователем.
  v_before := greatest(0, v_net, COALESCE(v_order.prepayment, 0) +
    CASE WHEN NULLIF(trim(COALESCE(v_order.remaining_to, '')), '') IS NOT NULL
      THEN COALESCE(v_order.remaining_amount, 0) ELSE 0 END);
  v_total := v_before + p_amount;
  IF v_total > v_order.amount THEN
    RAISE EXCEPTION 'Доходы по заказу превысят стоимость' USING ERRCODE = '22023';
  END IF;
  v_remaining := greatest(v_order.amount - v_total, 0);
  SELECT string_agg(btrim(part), ', ' ORDER BY ord)
    INTO v_address
  FROM regexp_split_to_table(COALESCE(v_order.address, ''), '[[:space:]]*,[[:space:]]*')
    WITH ORDINALITY AS address_part(part, ord)
  WHERE btrim(part) <> ''
    AND btrim(part) !~* '^(г\.?[[:space:]]*Волгоград|Волгоградская[[:space:]]+(обл\.?|область)|(Тракторозаводский|Краснооктябрьский|Дзержинский|Центральный|Ворошиловский|Советский|Кировский|Красноармейский)[[:space:]]+(р-н\.?|район))$';
  v_author := CASE lower(COALESCE(auth.jwt() ->> 'email', ''))
    WHEN 'golubintsev26@gmail.com' THEN 'Дима'
    WHEN 'aver1978aver@gmail.com' THEN 'Вова'
    WHEN 'golubintsev@gmail.com' THEN 'Алексей'
    WHEN 'lexa@mail.ru' THEN 'Алексей'
    WHEN 'alenushka191179@gmail.com' THEN 'Лена'
    WHEN 'fabrikaokon2019@mail.ru' THEN 'Андрей'
    WHEN 'lary_7812@mail.ru' THEN 'Кристина'
    ELSE 'неизв..' END;
  INSERT INTO public.calculations (order_id, from_place, to_place, amount, comment)
    VALUES (p_order_id, 'Клиент', p_to_place, p_amount,
      '[AUTO_ORDER_DELTA] Доход; ' || p_order_id::text || '; ' ||
      COALESCE(NULLIF(v_order.client, ''), '[__]') || '; ' ||
      COALESCE(NULLIF(v_address, ''), NULLIF(v_order.address, ''), '[__]') || '; ' ||
      COALESCE(NULLIF(trim(p_comment), ''), 'Поступление') || '; Остаток: ' ||
      v_remaining::text || '; ' ||
      to_char(clock_timestamp() AT TIME ZONE 'Europe/Moscow', 'HH24:MI') || '; ' || v_author)
    RETURNING id INTO v_calculation_id;

  IF v_total < v_order.amount THEN
    UPDATE public.orders SET prepayment = v_total,
      prepayment_to = COALESCE(NULLIF(v_order.prepayment_to, ''), p_to_place),
      remaining_amount = v_order.amount - v_total, remaining_to = NULL
    WHERE id = p_order_id;
  ELSIF v_before = 0 THEN
    -- Единственное поступление на всю стоимость относится к «Остатку».
    UPDATE public.orders SET prepayment = 0, prepayment_to = NULL,
      remaining_amount = p_amount, remaining_to = p_to_place
    WHERE id = p_order_id;
  ELSE
    UPDATE public.orders SET prepayment = v_order.amount - p_amount,
      prepayment_to = COALESCE(NULLIF(v_order.prepayment_to, ''), p_to_place),
      remaining_amount = p_amount, remaining_to = p_to_place
    WHERE id = p_order_id;
  END IF;
  SELECT jsonb_build_object('id', id, 'prepayment', prepayment,
    'prepayment_to', prepayment_to, 'remaining_amount', remaining_amount,
    'remaining_to', remaining_to, 'paid',
      remaining_amount = 0 OR NULLIF(trim(COALESCE(remaining_to, '')), '') IS NOT NULL)
    INTO v_result FROM public.orders WHERE id = p_order_id;
  INSERT INTO public.order_income_requests (request_id, user_id, order_id, calculation_id, result)
    VALUES (p_request_id, auth.uid(), p_order_id, v_calculation_id, v_result);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.add_order_income(uuid, bigint, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_order_income(uuid, bigint, text, numeric, text) TO authenticated;
COMMIT;
NOTIFY pgrst, 'reload schema';
