-- Редактирование групповых чатов: аватар + UPDATE для участников.
-- Выполнить в Supabase → SQL Editor (если supabase_group_chats.sql уже применяли ранее).

ALTER TABLE public.group_chats
  ADD COLUMN IF NOT EXISTS avatar_storage_path text;

COMMENT ON COLUMN public.group_chats.avatar_storage_path IS
  'Путь к картинке группы в bucket order-files (…/group-avatars/… или …/messages/…)';

DROP POLICY IF EXISTS "group_chats_update_member" ON public.group_chats;
CREATE POLICY "group_chats_update_member" ON public.group_chats
  FOR UPDATE TO authenticated
  USING (auth.uid() = ANY (member_ids))
  WITH CHECK (auth.uid() = ANY (member_ids));
