-- RLS-ограничения для роли user_shop:
-- user_shop может работать только с заказами типа "Магазин".
-- Политики сделаны RESTRICTIVE, чтобы ограничение применялось
-- даже при наличии широких permissive-политик для authenticated.

BEGIN;

-- ---------- helpers ----------
-- Роль текущего пользователя из profiles.
-- Если профиль отсутствует, считаем роль "user" (без shop-ограничения).
CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid()),
    'user'
  );
$$;

-- ---------- orders ----------
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "restrict_user_shop_orders_only_shop_type" ON public.orders;
CREATE POLICY "restrict_user_shop_orders_only_shop_type"
ON public.orders
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
  public.current_app_role() <> 'user_shop'
  OR order_type = 'Магазин'
)
WITH CHECK (
  public.current_app_role() <> 'user_shop'
  OR order_type = 'Магазин'
);

-- ---------- order_tasks ----------
ALTER TABLE public.order_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "restrict_user_shop_order_tasks_only_shop_orders" ON public.order_tasks;
CREATE POLICY "restrict_user_shop_order_tasks_only_shop_orders"
ON public.order_tasks
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
  public.current_app_role() <> 'user_shop'
  OR EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = order_tasks.order_id
      AND o.order_type = 'Магазин'
  )
)
WITH CHECK (
  public.current_app_role() <> 'user_shop'
  OR EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = order_tasks.order_id
      AND o.order_type = 'Магазин'
  )
);

-- ---------- order_history ----------
ALTER TABLE public.order_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "restrict_user_shop_order_history_only_shop_orders" ON public.order_history;
CREATE POLICY "restrict_user_shop_order_history_only_shop_orders"
ON public.order_history
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
  public.current_app_role() <> 'user_shop'
  OR EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = order_history.order_id
      AND o.order_type = 'Магазин'
  )
)
WITH CHECK (
  public.current_app_role() <> 'user_shop'
  OR EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = order_history.order_id
      AND o.order_type = 'Магазин'
  )
);

COMMIT;

-- Проверки после применения (опционально):
-- SELECT policyname, permissive, roles, cmd
-- FROM pg_policies
-- WHERE schemaname='public'
--   AND tablename IN ('orders','order_tasks','order_history')
-- ORDER BY tablename, policyname;
