-- Главная страница «Заказы» пишется в журнал как / (также поддерживаем /all).
-- Учесть посещения за сегодня, предшествовавшие установке ежедневных шуток.
INSERT INTO public.finance_director_daily_jokes (recipient_id, local_day)
SELECT DISTINCT l.user_id, (l.created_at AT TIME ZONE 'Europe/Moscow')::date
FROM public.site_access_logs l
JOIN auth.users u ON u.id = l.user_id
WHERE l.page_path IN ('/', '/all')
  AND lower(u.email) IN ('golubintsev26@gmail.com', 'golubintsev@gmail.com', 'lexa@mail.ru')
  AND (l.created_at AT TIME ZONE 'Europe/Moscow')::date = (now() AT TIME ZONE 'Europe/Moscow')::date
ON CONFLICT DO NOTHING;
