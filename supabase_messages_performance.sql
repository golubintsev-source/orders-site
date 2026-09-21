-- Индексы критического пути раздела «Сообщения».
-- Выполнить один раз в Supabase SQL Editor.
--
-- Клиент открывает диалог запросом двух направлений переписки:
--   sender = me AND recipient = peer
--   sender = peer AND recipient = me
-- и сортирует последние записи по created_at/id. Отдельные индексы позволяют
-- PostgreSQL собрать BitmapOr без полного просмотра user_messages.

CREATE INDEX IF NOT EXISTS idx_user_messages_sender_recipient_created
  ON public.user_messages (sender_id, recipient_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_user_messages_recipient_sender_created
  ON public.user_messages (recipient_id, sender_id, created_at DESC, id DESC);

-- Быстрый список последних диалогов пользователя в обоих направлениях.
CREATE INDEX IF NOT EXISTS idx_user_messages_sender_created
  ON public.user_messages (sender_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_user_messages_recipient_created
  ON public.user_messages (recipient_id, created_at DESC, id DESC);

-- Непрочитанные сообщения считаются отдельно и не должны сканировать удалённые.
CREATE INDEX IF NOT EXISTS idx_user_messages_unread_active
  ON public.user_messages (recipient_id, sender_id, created_at DESC, id DESC)
  WHERE read_at IS NULL AND deleted_at IS NULL;

-- Последний экран группового диалога и фоновая догрузка истории.
CREATE INDEX IF NOT EXISTS idx_group_messages_chat_created_desc
  ON public.group_messages (chat_id, created_at DESC, id DESC);

-- Статусы прочтения всех участников выбранных групп.
CREATE INDEX IF NOT EXISTS idx_group_chat_reads_chat_user
  ON public.group_chat_reads (chat_id, user_id);

ANALYZE public.user_messages;
ANALYZE public.group_messages;
ANALYZE public.group_chat_reads;
