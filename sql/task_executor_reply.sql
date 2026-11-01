-- One editable reply shared by a task's assigned executors.
ALTER TABLE public.order_tasks
  ADD COLUMN IF NOT EXISTS executor_reply text NOT NULL DEFAULT '';
COMMENT ON COLUMN public.order_tasks.executor_reply IS 'Saved reply entered by an assigned task executor';
NOTIFY pgrst, 'reload schema';
