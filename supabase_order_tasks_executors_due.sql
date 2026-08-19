-- Исполнители и срок выполнения для задач. Выполнить в Supabase SQL Editor.
ALTER TABLE order_tasks
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS executor_emails text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_order_tasks_due_at ON order_tasks (due_at)
  WHERE due_at IS NOT NULL;
