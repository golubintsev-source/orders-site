-- Уникальная ссылка для входа без пароля: login.html?key=...
-- Выполнить в Supabase → SQL Editor.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS login_key text;

UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND (p.email IS NULL OR btrim(p.email) = '');

UPDATE public.profiles
SET login_key = gen_random_uuid()::text
WHERE login_key IS NULL OR login_key = '';

ALTER TABLE public.profiles ALTER COLUMN login_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_login_key_uidx ON public.profiles (login_key);

CREATE OR REPLACE FUNCTION public.profiles_set_login_key()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.login_key IS NULL OR btrim(NEW.login_key) = '' THEN
    NEW.login_key := gen_random_uuid()::text;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_login_key_before_insert ON public.profiles;
CREATE TRIGGER profiles_login_key_before_insert
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_set_login_key();

-- Админ может перевыпустить ключ (кнопка «Новая ссылка» в настройках).
DROP POLICY IF EXISTS "profiles_update_login_key_admin" ON public.profiles;
CREATE POLICY "profiles_update_login_key_admin" ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid()) = 'admin'
  )
  WITH CHECK (
    (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid()) = 'admin'
  );
