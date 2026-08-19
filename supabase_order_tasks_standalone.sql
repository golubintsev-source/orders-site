-- Задачи без привязки к заказу, статус выполнения и видимость для автора/исполнителей.
-- Выполнить в Supabase SQL Editor.

BEGIN;

-- order_id необязателен (задача не привязана к заказу)
ALTER TABLE order_tasks ALTER COLUMN order_id DROP NOT NULL;

ALTER TABLE order_tasks DROP CONSTRAINT IF EXISTS order_tasks_order_id_fkey;
ALTER TABLE order_tasks
  ADD CONSTRAINT order_tasks_order_id_fkey
  FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE SET NULL;

ALTER TABLE order_tasks
  ADD COLUMN IF NOT EXISTS is_completed boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_order_tasks_is_completed ON order_tasks (is_completed)
  WHERE NOT is_completed;

-- Email текущего пользователя для RLS
CREATE OR REPLACE FUNCTION public.current_user_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(trim(COALESCE(
    (SELECT p.email FROM public.profiles p WHERE p.id = auth.uid()),
    auth.jwt() ->> 'email'
  )));
$$;

CREATE OR REPLACE FUNCTION public.task_is_self_assigned(task_author text, task_executors text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(array_length(task_executors, 1), 0) > 0
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(COALESCE(task_executors, '{}'::text[])) AS e
      WHERE lower(trim(e)) <> lower(trim(task_author))
        AND trim(e) <> ''
    );
$$;

CREATE OR REPLACE FUNCTION public.task_visible_to_user(task_author text, task_executors text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.current_user_email() <> ''
    AND (
      lower(trim(task_author)) = public.current_user_email()
      OR (
        NOT public.task_is_self_assigned(task_author, task_executors)
        AND public.current_user_email() = ANY (
          SELECT lower(trim(e)) FROM unnest(COALESCE(task_executors, '{}'::text[])) AS e
        )
      )
    );
$$;

ALTER TABLE order_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for authenticated" ON order_tasks;
DROP POLICY IF EXISTS "restrict_user_shop_order_tasks_only_shop_orders" ON order_tasks;

CREATE POLICY "order_tasks_select_participants" ON order_tasks
  FOR SELECT
  TO authenticated
  USING (public.task_visible_to_user(author_login, executor_emails));

CREATE POLICY "order_tasks_insert_author" ON order_tasks
  FOR INSERT
  TO authenticated
  WITH CHECK (lower(trim(author_login)) = public.current_user_email());

CREATE POLICY "order_tasks_update_participants" ON order_tasks
  FOR UPDATE
  TO authenticated
  USING (public.task_visible_to_user(author_login, executor_emails))
  WITH CHECK (public.task_visible_to_user(author_login, executor_emails));

CREATE POLICY "order_tasks_delete_author" ON order_tasks
  FOR DELETE
  TO authenticated
  USING (lower(trim(author_login)) = public.current_user_email());

COMMIT;
