-- Ответ / изменение / удаление сообщений в чатах.
-- Выполнить в Supabase → SQL Editor.

-- Личные сообщения
ALTER TABLE public.user_messages
  ADD COLUMN IF NOT EXISTS reply_to_id bigint REFERENCES public.user_messages (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_user_messages_reply_to_id
  ON public.user_messages (reply_to_id)
  WHERE reply_to_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_messages_active
  ON public.user_messages (created_at DESC)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.user_messages.reply_to_id IS 'ID сообщения, на которое отвечают';
COMMENT ON COLUMN public.user_messages.edited_at IS 'Время последнего изменения текста';
COMMENT ON COLUMN public.user_messages.deleted_at IS 'Мягкое удаление: NULL = активно';

-- Отправитель может править/мягко удалять свои сообщения;
-- получатель по-прежнему обновляет read_at / delivered_at.
DROP POLICY IF EXISTS "user_messages_update_read" ON public.user_messages;
DROP POLICY IF EXISTS "user_messages_update_participants" ON public.user_messages;
CREATE POLICY "user_messages_update_participants" ON public.user_messages
  FOR UPDATE TO authenticated
  USING (sender_id = auth.uid() OR recipient_id = auth.uid())
  WITH CHECK (sender_id = auth.uid() OR recipient_id = auth.uid());

-- Групповые сообщения
ALTER TABLE public.group_messages
  ADD COLUMN IF NOT EXISTS reply_to_id bigint REFERENCES public.group_messages (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_group_messages_reply_to_id
  ON public.group_messages (reply_to_id)
  WHERE reply_to_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_group_messages_active
  ON public.group_messages (chat_id, created_at)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.group_messages.reply_to_id IS 'ID сообщения, на которое отвечают';
COMMENT ON COLUMN public.group_messages.edited_at IS 'Время последнего изменения текста';
COMMENT ON COLUMN public.group_messages.deleted_at IS 'Мягкое удаление: NULL = активно';

DROP POLICY IF EXISTS "group_messages_update_sender" ON public.group_messages;
CREATE POLICY "group_messages_update_sender" ON public.group_messages
  FOR UPDATE TO authenticated
  USING (sender_id = auth.uid())
  WITH CHECK (sender_id = auth.uid());
