-- Журнал обращений к сайту. Выполнить в Supabase → SQL Editor → Run.
CREATE TABLE IF NOT EXISTS site_access_logs (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email text,
  page_path text NOT NULL,
  page_title text,
  device_type text,
  device_name text,
  os_name text,
  os_version text,
  city text,
  country text,
  vpn_detected boolean,
  response_time_ms integer,
  work_mode text NOT NULL DEFAULT 'online' CHECK (work_mode IN ('online', 'offline'))
);

CREATE INDEX IF NOT EXISTS site_access_logs_created_at_idx ON site_access_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS site_access_logs_user_id_idx ON site_access_logs (user_id);
CREATE INDEX IF NOT EXISTS site_access_logs_page_path_idx ON site_access_logs (page_path);

ALTER TABLE site_access_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_insert_own_access_logs" ON site_access_logs;
CREATE POLICY "authenticated_insert_own_access_logs"
  ON site_access_logs FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "admin_read_access_logs" ON site_access_logs;
CREATE POLICY "admin_read_access_logs"
  ON site_access_logs FOR SELECT
  TO authenticated
  USING (public.current_app_role() = 'admin');

-- Права на таблицу для роли authenticated (без GRANT INSERT/SELECT не работают даже при RLS).
GRANT SELECT, INSERT ON public.site_access_logs TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.site_access_logs_id_seq TO authenticated;

-- Если функции current_app_role() ещё нет (не выполняли supabase_rls_user_shop.sql):
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

-- Для уже созданной таблицы (миграция):
ALTER TABLE public.site_access_logs
  ADD COLUMN IF NOT EXISTS work_mode text NOT NULL DEFAULT 'online';

ALTER TABLE public.site_access_logs DROP CONSTRAINT IF EXISTS site_access_logs_work_mode_check;
ALTER TABLE public.site_access_logs
  ADD CONSTRAINT site_access_logs_work_mode_check CHECK (work_mode IN ('online', 'offline'));
