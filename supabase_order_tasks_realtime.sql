-- Событийное обновление счётчика задач вместо минутного опроса.
-- Идемпотентно добавляет order_tasks в существующую публикацию Supabase Realtime.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'order_tasks'
  ) then
    alter publication supabase_realtime add table public.order_tasks;
  end if;
end
$$;
