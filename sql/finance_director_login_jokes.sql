-- После пяти часов без входа Димы и Алексея отправляем одну шутку обоим.
BEGIN;

CREATE TABLE public.finance_director_login_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  last_entered_at timestamptz
);
ALTER TABLE public.finance_director_login_state ENABLE ROW LEVEL SECURITY;

-- При установке учитываем уже записанные посещения, чтобы не отправить
-- внезапную шутку сразу после развёртывания.
INSERT INTO public.finance_director_login_state (singleton, last_entered_at)
SELECT true, max(l.created_at)
FROM public.site_access_logs l
WHERE lower(l.user_email) IN
  ('golubintsev26@gmail.com', 'golubintsev@gmail.com', 'lexa@mail.ru');

CREATE FUNCTION public.check_finance_director_joke()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text;
  v_last timestamptz;
  v_joke text;
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
  FROM auth.users u WHERE u.id = auth.uid();
  IF v_email IS NULL OR v_email NOT IN
    ('golubintsev26@gmail.com', 'golubintsev@gmail.com', 'lexa@mail.ru') THEN
    RETURN;
  END IF;

  -- Блокировка одной строки сериализует даже одновременные входы с двух устройств.
  SELECT last_entered_at INTO v_last
  FROM public.finance_director_login_state WHERE singleton = true FOR UPDATE;

  UPDATE public.finance_director_login_state
  SET last_entered_at = clock_timestamp() WHERE singleton = true;

  IF v_last IS NOT NULL AND v_last > clock_timestamp() - interval '5 hours' THEN
    RETURN;
  END IF;

  v_joke := v_jokes[1 + floor(random() * array_length(v_jokes, 1))::integer];

  INSERT INTO public.user_messages
    (sender_id, sender_email, recipient_id, recipient_email, body)
  SELECT 'f1a4c3d2-0b55-4fac-8d20-8c3be97e0f01'::uuid,
    'finance-director@system.local', u.id, u.email,
    v_joke
  FROM auth.users u
  WHERE lower(u.email) IN
    ('golubintsev26@gmail.com', 'golubintsev@gmail.com', 'lexa@mail.ru');
END;
$$;

REVOKE ALL ON FUNCTION public.check_finance_director_joke() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_finance_director_joke() TO authenticated;

COMMIT;
