-- Read-only chat list and badge. Run before deploying the web client.
begin;

create or replace function public.get_chat_summary(
  p_badge_only boolean default false,
  p_open_group uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with viewer as (
    select auth.uid() as id
  ),
  dm as (
    select m.id, m.sender_id, m.recipient_id, m.sender_email, m.recipient_email,
      m.body, m.created_at, m.read_at, m.delivered_at, m.attachment_storage_path,
      case when m.sender_id = v.id then m.recipient_id else m.sender_id end as peer_id,
      m.recipient_id = v.id and m.read_at is null as unread
    from viewer v
    join public.user_messages m on m.sender_id = v.id or m.recipient_id = v.id
    where m.deleted_at is null
      and (not p_badge_only or (m.recipient_id = v.id and m.read_at is null))
  ),
  dm_counts as (
    select peer_id, count(*) filter (where unread) as unread_count
    from dm
    group by peer_id
  ),
  dm_latest as (
    select distinct on (peer_id) *
    from dm
    where not p_badge_only
    order by peer_id, created_at desc, id desc
  ),
  dm_outgoing as (
    select distinct on (m.peer_id)
      m.peer_id, m.id, m.sender_id, m.recipient_id, m.created_at, m.read_at, m.delivered_at
    from dm m
    join viewer v on m.sender_id = v.id
    where not p_badge_only
    order by m.peer_id, m.created_at desc, m.id desc
  ),
  groups as (
    select g.id, g.name, g.created_by, g.member_ids, g.created_at, g.avatar_storage_path,
      (select count(*)
       from public.group_messages m
       where m.chat_id = g.id and m.sender_id <> v.id and m.deleted_at is null
         and (r.last_read_at is null or m.created_at > r.last_read_at)
      ) as unread_count
    from viewer v
    join public.group_chats g on g.member_ids @> array[v.id]
    left join public.group_chat_reads r on r.chat_id = g.id and r.user_id = v.id
    where v.id is not null and (not p_badge_only or g.id is distinct from p_open_group)
  ),
  dialogs as (
    select c.peer_id::text as peer_id, 'user' as kind, c.unread_count,
      to_jsonb(m) - 'peer_id' - 'unread' as last_message,
      to_jsonb(o) - 'peer_id' as last_outgoing,
      null::jsonb as group_chat
    from dm_counts c
    join dm_latest m using (peer_id)
    left join dm_outgoing o using (peer_id)

    union all

    select 'group:' || g.id, 'group', g.unread_count, to_jsonb(m), null::jsonb,
      to_jsonb(g) - 'unread_count'
    from groups g
    left join lateral (
      select id, chat_id, sender_id, sender_email, body, created_at, attachment_storage_path
      from public.group_messages
      where chat_id = g.id and deleted_at is null
      order by created_at desc, id desc
      limit 1
    ) m on true
    where not p_badge_only
  )
  select jsonb_build_object(
    'unread_count',
      coalesce((select sum(unread_count) from dm_counts), 0)
      + coalesce((select sum(unread_count) from groups), 0),
    'dialogs', case when p_badge_only then '[]'::jsonb
      else coalesce((select jsonb_agg(to_jsonb(d) order by
        coalesce(d.last_message->>'created_at', d.group_chat->>'created_at') desc nulls last,
        d.peer_id) from dialogs d), '[]'::jsonb)
      end
  );
$$;

revoke execute on function public.get_chat_summary(boolean, uuid) from public, anon;
grant execute on function public.get_chat_summary(boolean, uuid) to authenticated;

commit;
