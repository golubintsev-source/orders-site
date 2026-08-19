-- Личная задача (автор = единственный исполнитель): видна только автору.
-- Выполнить в Supabase SQL Editor, если уже применён supabase_order_tasks_standalone.sql.

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
