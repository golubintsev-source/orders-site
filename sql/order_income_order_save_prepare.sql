-- Подготовлено для проверки. НЕ применять без разрешения владельца.
-- Переустанавливает только тело существующей функции, не меняя таблицы и индексы.
BEGIN;

CREATE OR REPLACE FUNCTION public.save_order_atomic(
  p_request_id uuid,
  p_order_id bigint,
  p_order jsonb,
  p_history_comments text[] DEFAULT ARRAY[]::text[],
  p_calculations jsonb DEFAULT '[]'::jsonb,
  p_expected_money jsonb DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_email text := nullif(auth.jwt() ->> 'email', '');
  v_order public.orders%ROWTYPE;
  v_current_order public.orders%ROWTYPE;
  v_saved_order_id bigint;
  v_income numeric;
  v_existing_income numeric;
BEGIN
  IF v_user_id IS NULL OR v_user_email IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_order IS NULL OR jsonb_typeof(p_order) <> 'object' THEN
    RAISE EXCEPTION 'order payload must be a JSON object' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_calculations, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'calculations payload must be a JSON array' USING ERRCODE = '22023';
  END IF;

  -- Сериализует повторы одного запроса, включая повтор после сетевого таймаута.
  PERFORM pg_advisory_xact_lock(hashtext(p_request_id::text));
  SELECT t.order_id
    INTO v_saved_order_id
    FROM public.order_save_transactions t
   WHERE t.request_id = p_request_id
     AND t.user_id = v_user_id;
  IF FOUND THEN
    RETURN v_saved_order_id;
  END IF;

  v_order := jsonb_populate_record(NULL::public.orders, p_order);

  IF p_order_id IS NULL THEN
    IF COALESCE(v_order.prepayment, 0) <> 0
       OR NULLIF(trim(COALESCE(v_order.prepayment_to, '')), '') IS NOT NULL
       OR NULLIF(trim(COALESCE(v_order.remaining_to, '')), '') IS NOT NULL
       OR v_order.remaining_amount IS DISTINCT FROM v_order.amount THEN
      RAISE EXCEPTION 'Доходы добавляются после создания заказа через форму «Добавить доход»'
        USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.orders (
      phone, client, order_type, address, payment_status, order_date,
      order_number, description, amount, prepayment, prepayment_to,
      remaining_amount, remaining_to, area_m2, mosquito_nets,
      construction_count, delivery, delivery_date, installation,
      installation_date, reveals, reveals_date, installer_name,
      installer_payment_amount, installer_payment_by, save_idempotency_key
    ) VALUES (
      v_order.phone, v_order.client, v_order.order_type, v_order.address,
      v_order.payment_status, v_order.order_date, v_order.order_number,
      v_order.description, v_order.amount, v_order.prepayment,
      v_order.prepayment_to, v_order.remaining_amount, v_order.remaining_to,
      v_order.area_m2, v_order.mosquito_nets, v_order.construction_count,
      v_order.delivery, v_order.delivery_date, v_order.installation,
      v_order.installation_date, v_order.reveals, v_order.reveals_date,
      v_order.installer_name, v_order.installer_payment_amount,
      v_order.installer_payment_by, v_order.save_idempotency_key
    )
    RETURNING id INTO v_saved_order_id;
  ELSE
    -- Блокировка строки исключает одновременное наложение двух сохранений заказа.
    SELECT * INTO v_current_order
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Order % is unavailable or does not exist', p_order_id
        USING ERRCODE = 'P0002';
    END IF;

    -- Вычисляемые денежные поля не должны превращаться в новые проводки
    -- при обычном сохранении заказа. Смена стоимости не может создать переплату.
    v_existing_income := COALESCE(v_current_order.prepayment, 0) +
      CASE WHEN NULLIF(trim(COALESCE(v_current_order.remaining_to, '')), '') IS NOT NULL
        THEN COALESCE(v_current_order.remaining_amount, 0) ELSE 0 END;
    IF v_order.amount IS DISTINCT FROM v_current_order.amount THEN
      SELECT greatest(v_existing_income, COALESCE(sum(CASE
        WHEN from_place = 'Клиент' AND to_place IN ('Дима','Вова','Безнал','Касса') THEN amount
        WHEN to_place = 'Клиент' AND from_place IN ('Дима','Вова','Безнал','Касса') THEN -amount
        ELSE 0 END), 0)) INTO v_income
      FROM public.calculations WHERE order_id = p_order_id AND deleted_at IS NULL;
      IF v_order.amount IS NOT NULL AND v_order.amount < v_income THEN
        RAISE EXCEPTION 'Стоимость меньше уже полученных доходов' USING ERRCODE = '22023';
      END IF;
      IF v_order.prepayment IS DISTINCT FROM v_income OR
         v_order.remaining_amount IS DISTINCT FROM (v_order.amount - v_income) THEN
        RAISE EXCEPTION 'Денежные поля необходимо пересчитать по доходам' USING ERRCODE = '22023';
      END IF;
    ELSIF v_order.prepayment IS DISTINCT FROM v_current_order.prepayment OR
          v_order.remaining_amount IS DISTINCT FROM v_current_order.remaining_amount OR
          v_order.prepayment_to IS DISTINCT FROM v_current_order.prepayment_to OR
          v_order.remaining_to IS DISTINCT FROM v_current_order.remaining_to THEN
      RAISE EXCEPTION 'Доходы добавляются только через форму «Добавить доход»' USING ERRCODE = '22023';
    END IF;

    -- Автопроводки рассчитаны от снимка, который видел пользователь. Если другой
    -- пользователь уже поменял денежные поля, отменяем всё вместо неверной дельты.
    IF p_expected_money IS NOT NULL AND (
      to_jsonb(v_current_order) -> 'amount' IS DISTINCT FROM p_expected_money -> 'amount'
      OR to_jsonb(v_current_order) -> 'prepayment' IS DISTINCT FROM p_expected_money -> 'prepayment'
      OR to_jsonb(v_current_order) -> 'prepayment_to' IS DISTINCT FROM p_expected_money -> 'prepayment_to'
      OR to_jsonb(v_current_order) -> 'remaining_amount' IS DISTINCT FROM p_expected_money -> 'remaining_amount'
      OR to_jsonb(v_current_order) -> 'remaining_to' IS DISTINCT FROM p_expected_money -> 'remaining_to'
      OR to_jsonb(v_current_order) -> 'installer_payment_amount' IS DISTINCT FROM p_expected_money -> 'installer_payment_amount'
      OR to_jsonb(v_current_order) -> 'installer_payment_by' IS DISTINCT FROM p_expected_money -> 'installer_payment_by'
    ) THEN
      RAISE EXCEPTION 'Order money fields were changed by another user; reload the order'
        USING ERRCODE = '40001';
    END IF;

    UPDATE public.orders SET
      phone = v_order.phone,
      client = v_order.client,
      order_type = v_order.order_type,
      address = v_order.address,
      payment_status = v_order.payment_status,
      order_date = v_order.order_date,
      order_number = v_order.order_number,
      description = v_order.description,
      amount = v_order.amount,
      prepayment = v_order.prepayment,
      prepayment_to = v_order.prepayment_to,
      remaining_amount = v_order.remaining_amount,
      remaining_to = v_order.remaining_to,
      area_m2 = v_order.area_m2,
      mosquito_nets = v_order.mosquito_nets,
      construction_count = v_order.construction_count,
      delivery = v_order.delivery,
      delivery_date = v_order.delivery_date,
      installation = v_order.installation,
      installation_date = v_order.installation_date,
      reveals = v_order.reveals,
      reveals_date = v_order.reveals_date,
      installer_name = v_order.installer_name,
      installer_payment_amount = v_order.installer_payment_amount,
      installer_payment_by = v_order.installer_payment_by
    WHERE id = p_order_id
    RETURNING id INTO v_saved_order_id;
  END IF;

  INSERT INTO public.order_history (order_id, user_email, comment)
  SELECT v_saved_order_id, v_user_email, btrim(comment)
  FROM unnest(COALESCE(p_history_comments, ARRAY[]::text[])) AS comment
  WHERE btrim(comment) <> '';

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_calculations, '[]'::jsonb)) AS c(comment text)
    WHERE c.comment IS NULL OR c.comment NOT LIKE '[AUTO_ORDER_DELTA]%'
  ) THEN
    RAISE EXCEPTION 'Only automatic order calculations are accepted'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.calculations (created_at, from_place, to_place, amount, comment, order_id)
  SELECT
    COALESCE(c.created_at, now()),
    c.from_place,
    c.to_place,
    c.amount,
    replace(c.comment, '{{ORDER_ID}}', v_saved_order_id::text),
    v_saved_order_id
  FROM jsonb_to_recordset(COALESCE(p_calculations, '[]'::jsonb)) AS c(
    created_at timestamptz,
    from_place text,
    to_place text,
    amount numeric,
    comment text
  );

  -- Маркер пишется последним. Любая ошибка выше откатывает и его, и все данные.
  INSERT INTO public.order_save_transactions (request_id, user_id, order_id)
  VALUES (p_request_id, v_user_id, v_saved_order_id);

  RETURN v_saved_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_order_atomic(uuid, bigint, jsonb, text[], jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_order_atomic(uuid, bigint, jsonb, text[], jsonb, jsonb) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Проверка установки (только чтение):
-- SELECT to_regprocedure('public.save_order_atomic(uuid,bigint,jsonb,text[],jsonb,jsonb)');
