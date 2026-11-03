-- Оптимизация RLS, индексов внешних ключей и autovacuum.
-- Выполнять целиком от роли postgres в Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- 1. RLS helpers: JWT email без обращения к profiles на каждой строке.
-- ---------------------------------------------------------------------------

create or replace function public.current_user_email()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select lower(btrim(coalesce((select auth.jwt()) ->> 'email', '')));
$$;

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select p.role
      from public.profiles p
      where p.id = (select auth.uid())
    ),
    'user'
  );
$$;

create or replace function public.task_is_self_assigned(
  task_author text,
  task_executors text[]
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select
    coalesce(array_length(task_executors, 1), 0) > 0
    and not exists (
      select 1
      from unnest(coalesce(task_executors, '{}'::text[])) as e
      where lower(btrim(e)) <> lower(btrim(task_author))
        and btrim(e) <> ''
    );
$$;

create or replace function public.task_visible_to_user(
  task_author text,
  task_executors text[],
  user_email text
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select
    lower(btrim(coalesce(user_email, ''))) <> ''
    and (
      lower(btrim(task_author)) = lower(btrim(user_email))
      or (
        not public.task_is_self_assigned(task_author, task_executors)
        and lower(btrim(user_email)) = any (
          array(
            select lower(btrim(e))
            from unnest(coalesce(task_executors, '{}'::text[])) as e
          )
        )
      )
    );
$$;

-- Совместимость с существующими вызовами вне RLS. В самих политиках ниже
-- используется трёхаргументная версия, а email передаётся через InitPlan.
create or replace function public.task_visible_to_user(
  task_author text,
  task_executors text[]
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select public.task_visible_to_user(
    task_author,
    task_executors,
    (select public.current_user_email())
  );
$$;

revoke all on function public.current_user_email() from public, anon;
revoke all on function public.current_app_role() from public, anon;
revoke all on function public.task_is_self_assigned(text, text[]) from public, anon;
revoke all on function public.task_visible_to_user(text, text[]) from public, anon;
revoke all on function public.task_visible_to_user(text, text[], text) from public, anon;
grant execute on function public.current_user_email() to authenticated, service_role;
grant execute on function public.current_app_role() to authenticated, service_role;
grant execute on function public.task_is_self_assigned(text, text[]) to authenticated, service_role;
grant execute on function public.task_visible_to_user(text, text[]) to authenticated, service_role;
grant execute on function public.task_visible_to_user(text, text[], text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. RLS policies: auth/JWT/role helpers are evaluated once per statement.
-- ---------------------------------------------------------------------------

alter policy admin_read_balance_view_logs on public.balance_view_logs
  using ((select public.current_app_role()) = 'admin');
alter policy authenticated_insert_own_balance_view_logs on public.balance_view_logs
  with check (user_id = (select auth.uid()));

alter policy contractor_checks_delete_full_users on public.contractor_checks
  using ((select public.current_app_role()) in ('admin', 'user'));
alter policy contractor_checks_insert_full_users on public.contractor_checks
  with check (
    created_by = (select auth.uid())
    and (select public.current_app_role()) in ('admin', 'user')
  );
alter policy contractor_checks_select_full_users on public.contractor_checks
  using ((select public.current_app_role()) in ('admin', 'user'));

alter policy group_chat_reads_insert_own on public.group_chat_reads
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.group_chats g
      where g.id = group_chat_reads.chat_id
        and (select auth.uid()) = any (g.member_ids)
    )
  );
alter policy group_chat_reads_select_member on public.group_chat_reads
  using (
    exists (
      select 1
      from public.group_chats g
      where g.id = group_chat_reads.chat_id
        and (select auth.uid()) = any (g.member_ids)
    )
  );
alter policy group_chat_reads_update_own on public.group_chat_reads
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.group_chats g
      where g.id = group_chat_reads.chat_id
        and (select auth.uid()) = any (g.member_ids)
    )
  );

alter policy group_chats_insert_own on public.group_chats
  with check (
    created_by = (select auth.uid())
    and (select auth.uid()) = any (member_ids)
  );
alter policy group_chats_select_member on public.group_chats
  using ((select auth.uid()) = any (member_ids));
alter policy group_chats_update_member on public.group_chats
  using ((select auth.uid()) = any (member_ids))
  with check ((select auth.uid()) = any (member_ids));

alter policy group_messages_insert_member on public.group_messages
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1
      from public.group_chats g
      where g.id = group_messages.chat_id
        and (select auth.uid()) = any (g.member_ids)
    )
  );
alter policy group_messages_select_member on public.group_messages
  using (
    exists (
      select 1
      from public.group_chats g
      where g.id = group_messages.chat_id
        and (select auth.uid()) = any (g.member_ids)
    )
  );
alter policy group_messages_update_sender on public.group_messages
  using (sender_id = (select auth.uid()))
  with check (sender_id = (select auth.uid()));

alter policy message_reactions_delete_own on public.message_reactions
  using (user_id = (select auth.uid()));
alter policy message_reactions_insert_own on public.message_reactions
  with check (
    user_id = (select auth.uid())
    and (
      (
        message_kind = 'user'
        and exists (
          select 1
          from public.user_messages m
          where m.id = message_reactions.message_id
            and m.deleted_at is null
            and (
              m.sender_id = (select auth.uid())
              or m.recipient_id = (select auth.uid())
            )
        )
      )
      or (
        message_kind = 'group'
        and exists (
          select 1
          from public.group_messages gm
          join public.group_chats g on g.id = gm.chat_id
          where gm.id = message_reactions.message_id
            and gm.deleted_at is null
            and (select auth.uid()) = any (g.member_ids)
        )
      )
    )
  );
alter policy message_reactions_select_participant on public.message_reactions
  using (
    (
      message_kind = 'user'
      and exists (
        select 1
        from public.user_messages m
        where m.id = message_reactions.message_id
          and m.deleted_at is null
          and (
            m.sender_id = (select auth.uid())
            or m.recipient_id = (select auth.uid())
          )
      )
    )
    or (
      message_kind = 'group'
      and exists (
        select 1
        from public.group_messages gm
        join public.group_chats g on g.id = gm.chat_id
        where gm.id = message_reactions.message_id
          and gm.deleted_at is null
          and (select auth.uid()) = any (g.member_ids)
      )
    )
  );
alter policy message_reactions_update_own on public.message_reactions
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy "authenticated can delete order_files" on public.order_files
  using (
    uploaded_by = (select auth.uid())
    or (select public.current_app_role()) = 'admin'
  );
alter policy "authenticated can insert order_files" on public.order_files
  with check (uploaded_by = (select auth.uid()));

alter policy restrict_user_shop_order_history_only_shop_orders on public.order_history
  using (
    (select public.current_app_role()) <> 'user_shop'
    or exists (
      select 1
      from public.orders o
      where o.id = order_history.order_id
        and o.order_type = 'Магазин'
    )
  )
  with check (
    (select public.current_app_role()) <> 'user_shop'
    or exists (
      select 1
      from public.orders o
      where o.id = order_history.order_id
        and o.order_type = 'Магазин'
    )
  );

alter policy order_save_transactions_insert_own on public.order_save_transactions
  with check (user_id = (select auth.uid()));
alter policy order_save_transactions_select_own on public.order_save_transactions
  using (user_id = (select auth.uid()));

alter policy order_tasks_delete_author on public.order_tasks
  using (lower(btrim(author_login)) = (select public.current_user_email()));
alter policy order_tasks_insert_author on public.order_tasks
  with check (lower(btrim(author_login)) = (select public.current_user_email()));
alter policy order_tasks_select_participants_or_order_cells on public.order_tasks
  using (
    public.task_visible_to_user(
      author_login,
      executor_emails,
      (select public.current_user_email())
    )
    or (order_id is not null and source_order_field is not null)
  );
alter policy order_tasks_update_participants on public.order_tasks
  using (
    public.task_visible_to_user(
      author_login,
      executor_emails,
      (select public.current_user_email())
    )
  )
  with check (
    public.task_visible_to_user(
      author_login,
      executor_emails,
      (select public.current_user_email())
    )
  );

alter policy "admins can delete orders" on public.orders
  using ((select public.current_app_role()) = 'admin');
alter policy "admins can update orders" on public.orders
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');
alter policy restrict_user_shop_orders_update_only_shop_type on public.orders
  using (
    (select public.current_app_role()) <> 'user_shop'
    or order_type = 'Магазин'
  )
  with check (
    (select public.current_app_role()) <> 'user_shop'
    or order_type = 'Магазин'
  );
alter policy restrict_user_shop_orders_write_only_shop_type on public.orders
  with check (
    (select public.current_app_role()) <> 'user_shop'
    or order_type = 'Магазин'
  );

alter policy profiles_update_login_key_admin on public.profiles
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');
alter policy "users can view own profile" on public.profiles
  using (id = (select auth.uid()));

alter policy "Users manage own push subscriptions" on public.push_subscriptions
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy admin_read_access_logs on public.site_access_logs
  using ((select public.current_app_role()) = 'admin');
alter policy authenticated_insert_own_access_logs on public.site_access_logs
  with check (user_id = (select auth.uid()));

alter policy user_messages_insert_own on public.user_messages
  with check (sender_id = (select auth.uid()));
alter policy user_messages_select_own on public.user_messages
  using (
    sender_id = (select auth.uid())
    or recipient_id = (select auth.uid())
  );
alter policy user_messages_update_participants on public.user_messages
  using (
    sender_id = (select auth.uid())
    or recipient_id = (select auth.uid())
  )
  with check (
    sender_id = (select auth.uid())
    or recipient_id = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 3. Missing indexes on foreign-key columns.
-- ---------------------------------------------------------------------------

create index if not exists contractor_checks_created_by_idx
  on public.contractor_checks (created_by);
create index if not exists group_chats_created_by_idx
  on public.group_chats (created_by);
create index if not exists group_messages_sender_id_idx
  on public.group_messages (sender_id);
create index if not exists order_files_order_id_idx
  on public.order_files (order_id);
create index if not exists order_files_uploaded_by_idx
  on public.order_files (uploaded_by);

-- page_path без created_at не соответствует запросам статистики и почти не
-- использовался. Индекс user_id сохраняем: он нужен для внешнего ключа.
drop index if exists public.site_access_logs_page_path_idx;

-- ---------------------------------------------------------------------------
-- 4. Per-table autovacuum for small, frequently updated tables.
-- ---------------------------------------------------------------------------

alter table public.group_chat_reads set (
  autovacuum_vacuum_threshold = 25,
  autovacuum_vacuum_scale_factor = 0.10,
  autovacuum_analyze_threshold = 25,
  autovacuum_analyze_scale_factor = 0.10
);

alter table public.user_messages set (
  autovacuum_vacuum_threshold = 25,
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_threshold = 25,
  autovacuum_analyze_scale_factor = 0.05
);

alter table public.order_tasks set (
  autovacuum_vacuum_threshold = 25,
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_threshold = 25,
  autovacuum_analyze_scale_factor = 0.05
);

alter table public.push_subscriptions set (
  autovacuum_vacuum_threshold = 25,
  autovacuum_vacuum_scale_factor = 0.10,
  autovacuum_analyze_threshold = 25,
  autovacuum_analyze_scale_factor = 0.10
);
