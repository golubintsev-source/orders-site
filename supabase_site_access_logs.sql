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
  response_time_ms integer
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
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );
