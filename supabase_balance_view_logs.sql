-- Журнал просмотров страницы «Баланс» (снимок строки «Сейчас»).
-- Выполнить в Supabase → SQL Editor → Run.
CREATE TABLE IF NOT EXISTS balance_view_logs (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email text,
  user_name text,
  amount_dima bigint NOT NULL DEFAULT 0,
  amount_vova bigint NOT NULL DEFAULT 0,
  amount_kassa bigint NOT NULL DEFAULT 0,
  amount_beznal bigint NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS balance_view_logs_created_at_idx ON balance_view_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS balance_view_logs_user_id_idx ON balance_view_logs (user_id);

ALTER TABLE balance_view_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_insert_own_balance_view_logs" ON balance_view_logs;
CREATE POLICY "authenticated_insert_own_balance_view_logs"
  ON balance_view_logs FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "admin_read_balance_view_logs" ON balance_view_logs;
CREATE POLICY "admin_read_balance_view_logs"
  ON balance_view_logs FOR SELECT
  TO authenticated
  USING (public.current_app_role() = 'admin');

GRANT SELECT, INSERT ON public.balance_view_logs TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.balance_view_logs_id_seq TO authenticated;

-- Если функции current_app_role() ещё нет:
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
