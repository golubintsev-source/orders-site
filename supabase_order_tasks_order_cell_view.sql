-- Задачи, привязанные к конкретным ячейкам заказов, доступны для просмотра
-- всем авторизованным пользователям. Изменение по-прежнему ограничивает
-- отдельная UPDATE-политика для автора и исполнителей.
-- Скрипт можно выполнять повторно.

BEGIN;

ALTER TABLE public.order_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "order_tasks_select_participants" ON public.order_tasks;
DROP POLICY IF EXISTS "order_tasks_select_participants_or_order_cells" ON public.order_tasks;

CREATE POLICY "order_tasks_select_participants_or_order_cells"
  ON public.order_tasks
  FOR SELECT
  TO authenticated
  USING (
    public.task_visible_to_user(author_login, executor_emails)
    OR (order_id IS NOT NULL AND source_order_field IS NOT NULL)
  );

COMMIT;

NOTIFY pgrst, 'reload schema';

