-- Связь задачи с сообщением, из которого она создана.
-- Выполнить в Supabase SQL Editor.

ALTER TABLE order_tasks
  ADD COLUMN IF NOT EXISTS source_message_id bigint,
  ADD COLUMN IF NOT EXISTS source_message_kind text;

CREATE INDEX IF NOT EXISTS idx_order_tasks_source_message_active
  ON order_tasks (source_message_kind, source_message_id)
  WHERE source_message_id IS NOT NULL AND NOT is_completed;

COMMENT ON COLUMN order_tasks.source_message_id IS 'ID сообщения (user_messages или group_messages)';
COMMENT ON COLUMN order_tasks.source_message_kind IS 'user — личный чат, group — групповой чат';
