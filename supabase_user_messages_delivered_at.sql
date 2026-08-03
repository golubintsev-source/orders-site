-- Доставка сообщений (delivered_at). Выполнить в Supabase SQL Editor.
-- read_at = прочитано получателем; delivered_at = сообщение получено клиентом получателя.

ALTER TABLE public.user_messages
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_user_messages_recipient_undelivered
  ON public.user_messages (recipient_id)
  WHERE delivered_at IS NULL;

-- Получатель уже может обновлять свои входящие (user_messages_update_read).
-- Дополнительных политик не требуется.
