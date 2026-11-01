-- Persist the source cell and the optional red/green outline for order-linked tasks.
ALTER TABLE public.order_tasks
  ADD COLUMN IF NOT EXISTS source_order_field text,
  ADD COLUMN IF NOT EXISTS highlight_order_field boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.order_tasks.source_order_field IS 'Stable order table field key for tasks created from a cell';
COMMENT ON COLUMN public.order_tasks.highlight_order_field IS 'Outline source cell: red while pending, green when completed';
NOTIFY pgrst, 'reload schema';
