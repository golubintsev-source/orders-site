-- Прочитанность групповых чатов (для бейджа и счётчика в списке).
-- Выполнить в Supabase → SQL Editor (после supabase_group_chats.sql).

CREATE TABLE IF NOT EXISTS public.group_chat_reads (
  chat_id uuid NOT NULL REFERENCES public.group_chats (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_chat_reads_user
  ON public.group_chat_reads (user_id);

COMMENT ON TABLE public.group_chat_reads IS
  'Момент, до которого пользователь прочитал сообщения группового чата';
COMMENT ON COLUMN public.group_chat_reads.last_read_at IS
  'Сообщения других участников с created_at > last_read_at считаются непрочитанными';

ALTER TABLE public.group_chat_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "group_chat_reads_select_own" ON public.group_chat_reads;
CREATE POLICY "group_chat_reads_select_own" ON public.group_chat_reads
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.group_chats g
      WHERE g.id = group_chat_reads.chat_id
        AND auth.uid() = ANY (g.member_ids)
    )
  );

DROP POLICY IF EXISTS "group_chat_reads_insert_own" ON public.group_chat_reads;
CREATE POLICY "group_chat_reads_insert_own" ON public.group_chat_reads
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.group_chats g
      WHERE g.id = group_chat_reads.chat_id
        AND auth.uid() = ANY (g.member_ids)
    )
  );

DROP POLICY IF EXISTS "group_chat_reads_update_own" ON public.group_chat_reads;
CREATE POLICY "group_chat_reads_update_own" ON public.group_chat_reads
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.group_chats g
      WHERE g.id = group_chat_reads.chat_id
        AND auth.uid() = ANY (g.member_ids)
    )
  );
