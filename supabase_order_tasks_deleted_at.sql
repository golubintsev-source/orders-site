-- Мягкое удаление задач (order_tasks).
-- Запись не удаляется физически — только проставляется deleted_at.
-- Удалять (помечать) может только автор задачи.
-- Выполнить в Supabase SQL Editor. Скрипт можно запускать повторно.

BEGIN;

ALTER TABLE public.order_tasks
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

COMMENT ON COLUMN public.order_tasks.deleted_at IS
  'NULL = активна; дата/время = мягко удалена (остаётся в БД)';

CREATE INDEX IF NOT EXISTS idx_order_tasks_deleted_at_null
  ON public.order_tasks (id)
  WHERE deleted_at IS NULL;

-- Только автор может менять deleted_at (мягкое удаление / восстановление).
CREATE OR REPLACE FUNCTION public.order_tasks_guard_deleted_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    IF lower(trim(COALESCE(OLD.author_login, ''))) <> public.current_user_email() THEN
      RAISE EXCEPTION 'Только автор задачи может помечать её удалённой'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_tasks_guard_deleted_at ON public.order_tasks;
CREATE TRIGGER trg_order_tasks_guard_deleted_at
  BEFORE UPDATE ON public.order_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.order_tasks_guard_deleted_at();

COMMIT;

NOTIFY pgrst, 'reload schema';
