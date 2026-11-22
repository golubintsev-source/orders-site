-- Одно случайное сообщение каждому при первом открытии «Заказов» за московский день.
BEGIN;

CREATE TABLE public.finance_director_daily_jokes (
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  local_day date NOT NULL,
  PRIMARY KEY (recipient_id, local_day)
);
ALTER TABLE public.finance_director_daily_jokes ENABLE ROW LEVEL SECURITY;

-- Уже состоявшиеся сегодняшние входы в «Заказы» считаем первым посещением дня.
INSERT INTO public.finance_director_daily_jokes (recipient_id, local_day)
SELECT DISTINCT l.user_id, (l.created_at AT TIME ZONE 'Europe/Moscow')::date
FROM public.site_access_logs l
JOIN auth.users u ON u.id = l.user_id
WHERE l.page_path = '/all'
  AND lower(u.email) IN ('golubintsev26@gmail.com', 'golubintsev@gmail.com', 'lexa@mail.ru')
  AND (l.created_at AT TIME ZONE 'Europe/Moscow')::date = (now() AT TIME ZONE 'Europe/Moscow')::date
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.check_finance_director_joke()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text;
  v_user uuid := auth.uid();
  v_day date := (clock_timestamp() AT TIME ZONE 'Europe/Moscow')::date;
  v_inserted uuid;
  v_jokes text[] := ARRAY[
    'Шеф, деньги есть. Но они уже знают, кому должны.',
    '— Зина, где деньги? — В обороте. — А оборот где? — Всё ещё набирает скорость.',
    'Зарплату выплатим вовремя. Осталось договориться со временем.',
    'Прибыль есть. Она просто очень скромная и не любит показываться.',
    'Шеф, касса не пустая. Там лежит список тех, кому мы должны.',
    'Бюджет на месяц составлен. Месяц пока не согласен.',
    'Клиент обещал оплатить завтра. Я уточнила, какого года.',
    'Хорошая новость: дебет сошёлся с кредитом. Плохая: оба ждут денег.',
    'Шеф, я нашла свободные деньги. Оказалось, это сдача за саморезы.',
    'Наш финансовый план крепче окна. Пока его не откроешь.',
    'Монтажники спрашивают про зарплату. Сказала, что вопрос уже на высшем уровне. Это вы.',
    'Деньги на счёте появились! Я даже успела с ними поздороваться.',
    'Шеф, у нас рост. Пока только расходов, но направление освоили.',
    'Предоплата пришла. Фурнитура узнала первой.',
    'Я бы сократила расходы, но они приходят без предупреждения.',
    'Клиент просит скидку. Поставщик просит оплату. А я прошу тишины.',
    'Шеф, финансовая подушка готова. Правда, размером с оконную прокладку.',
    'По документам всё прозрачно. Особенно остаток на счёте.',
    'Прибыль за месяц подсчитана. Не пугайтесь, я округлила вверх.',
    '— Деньги на зарплату есть? — Есть план, как их встретить.',
    'Наши деньги работают. К сожалению, сейчас в других компаниях.',
    'Смета была идеальной, пока её не увидела реальная стена.',
    'Шеф, мы вышли в плюс! На калькуляторе. Я пока не трогаю кнопки.',
    'Поставщик снова поднял цены. Видимо, окна у него с лифтом.',
    'Клиент оплатил заказ. Предлагаю объявить этот день праздником.',
    'Кассовый разрыв закрыли. Следующий уже стучится.',
    'Я попросила расходы вести себя скромнее. Они попросили пример.',
    'Шеф, на счёте есть деньги. Быстро смотрите, пока они там.',
    'Бухгалтерия любит точность: денег не «мало», а «до пятницы».',
    'Финансовый прогноз на завтра: ждём оплату и сохраняем чувство юмора.'
  ];
BEGIN
  SELECT lower(u.email) INTO v_email
  FROM auth.users u WHERE u.id = v_user;
  IF v_email IS NULL OR v_email NOT IN
    ('golubintsev26@gmail.com', 'golubintsev@gmail.com', 'lexa@mail.ru') THEN
    RETURN;
  END IF;

  -- Уникальный ключ исключает повторную отправку при одновременных вкладках.
  INSERT INTO public.finance_director_daily_jokes (recipient_id, local_day)
  VALUES (v_user, v_day)
  ON CONFLICT DO NOTHING RETURNING recipient_id INTO v_inserted;
  IF v_inserted IS NULL THEN RETURN; END IF;

  INSERT INTO public.user_messages
    (sender_id, sender_email, recipient_id, recipient_email, body)
  VALUES ('f1a4c3d2-0b55-4fac-8d20-8c3be97e0f01'::uuid,
    'finance-director@system.local', v_user, v_email,
    v_jokes[1 + floor(random() * array_length(v_jokes, 1))::integer]);
END;
$$;

COMMIT;
