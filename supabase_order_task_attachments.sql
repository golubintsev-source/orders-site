-- Photo metadata and order references inherit the task's participant RLS policies.
ALTER TABLE public.order_tasks
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(attachments) = 'array');

COMMENT ON COLUMN public.order_tasks.attachments IS
  'Task attachments: photo Storage paths or order IDs; never signed URLs or file contents.';
