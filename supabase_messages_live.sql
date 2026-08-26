-- Живые обновления чатов (как в Telegram/WhatsApp Web): Realtime + индекс для «прочитать весь диалог».
-- Выполнить в Supabase → SQL Editor. Без этого шага клиент всё равно работает,
-- но новые сообщения подтягиваются опросом, а не мгновенно по WebSocket.

CREATE INDEX IF NOT EXISTS idx_user_messages_recipient_sender_unread
  ON public.user_messages (recipient_id, sender_id)
  WHERE read_at IS NULL;

ALTER TABLE public.user_messages REPLICA IDENTITY FULL;
ALTER TABLE public.group_messages REPLICA IDENTITY FULL;
ALTER TABLE public.group_chat_reads REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_messages;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN
      RAISE NOTICE 'Publication supabase_realtime not found — enable Realtime in the dashboard';
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.group_messages;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.group_chat_reads;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END $$;
