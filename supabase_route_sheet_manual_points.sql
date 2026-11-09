-- Точки, добавленные вручную на странице «Маршрутный лист».
-- Таблица одновременно хранит сами точки и служит приоритетным источником подсказок.
CREATE TABLE IF NOT EXISTS public.route_sheet_manual_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_no text NOT NULL,
  delivery_date date NOT NULL,
  client text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  coordinates text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  remaining_amount numeric,
  area_m2 numeric,
  construction_count numeric,
  installation boolean NOT NULL DEFAULT false,
  reveals boolean NOT NULL DEFAULT false,
  phone text NOT NULL DEFAULT '',
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT route_sheet_manual_points_location_check
    CHECK (btrim(address) <> '' OR btrim(coordinates) <> '')
);

COMMENT ON TABLE public.route_sheet_manual_points IS
  'Точки доставки, вручную добавленные в маршрутный лист; приоритетный источник подсказок клиента и адреса.';

CREATE INDEX IF NOT EXISTS idx_route_sheet_manual_points_delivery_date
  ON public.route_sheet_manual_points (delivery_date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_route_sheet_manual_points_updated_at
  ON public.route_sheet_manual_points (updated_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.route_sheet_manual_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "route_sheet_manual_points_select_authenticated" ON public.route_sheet_manual_points;
CREATE POLICY "route_sheet_manual_points_select_authenticated"
  ON public.route_sheet_manual_points FOR SELECT TO authenticated
  USING (
    created_by = (select auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (select auth.uid())
        AND p.role IN ('admin', 'user', 'user_lite')
    )
  );

DROP POLICY IF EXISTS "route_sheet_manual_points_insert_authenticated" ON public.route_sheet_manual_points;
CREATE POLICY "route_sheet_manual_points_insert_authenticated"
  ON public.route_sheet_manual_points FOR INSERT TO authenticated
  WITH CHECK (created_by = (select auth.uid()));

DROP POLICY IF EXISTS "route_sheet_manual_points_update_authenticated" ON public.route_sheet_manual_points;
CREATE POLICY "route_sheet_manual_points_update_authenticated"
  ON public.route_sheet_manual_points FOR UPDATE TO authenticated
  USING (
    created_by = (select auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (select auth.uid())
        AND p.role IN ('admin', 'user', 'user_lite')
    )
  )
  WITH CHECK (
    created_by = (select auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (select auth.uid())
        AND p.role IN ('admin', 'user', 'user_lite')
    )
  );

GRANT SELECT, INSERT, UPDATE ON TABLE public.route_sheet_manual_points TO authenticated;
REVOKE ALL ON TABLE public.route_sheet_manual_points FROM anon;
