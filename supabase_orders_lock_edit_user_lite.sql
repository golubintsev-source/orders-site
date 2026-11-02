-- Флаг «закрыть редактирование для user_lite» у заказа. Выполнить в Supabase SQL Editor.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS lock_edit_for_user_lite smallint NOT NULL DEFAULT 0;

COMMENT ON COLUMN orders.lock_edit_for_user_lite IS '1 — user_lite не может редактировать заказ';

-- При переводе заказа в закрытый статус одновременно закрываем редактирование
-- для user_lite. Триггер покрывает все способы сохранения: форму, голосового
-- помощника и синхронизацию офлайн-очереди.
CREATE OR REPLACE FUNCTION public.lock_edit_when_order_closed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.payment_status = 'Заказ закрыт'
     AND (TG_OP = 'INSERT' OR OLD.payment_status IS DISTINCT FROM NEW.payment_status) THEN
    NEW.lock_edit_for_user_lite := 1;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_lock_edit_when_closed ON public.orders;
CREATE TRIGGER orders_lock_edit_when_closed
BEFORE INSERT OR UPDATE OF payment_status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.lock_edit_when_order_closed();

REVOKE ALL ON FUNCTION public.lock_edit_when_order_closed() FROM PUBLIC, anon, authenticated;
