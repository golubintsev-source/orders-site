-- Остальные ключи app_settings продолжают использовать свои текущие политики.
CREATE POLICY order_photo_validation_admin_insert ON public.app_settings
  AS RESTRICTIVE FOR INSERT TO PUBLIC
  WITH CHECK (
    key <> 'order_photo_validation_enabled'
    OR (value IN ('true', 'false') AND EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'
    ))
  );

CREATE POLICY order_photo_validation_admin_update ON public.app_settings
  AS RESTRICTIVE FOR UPDATE TO PUBLIC
  USING (
    key <> 'order_photo_validation_enabled'
    OR EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'
    )
  )
  WITH CHECK (
    key <> 'order_photo_validation_enabled'
    OR (value IN ('true', 'false') AND EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'
    ))
  );
