-- Поле «Кому» для излишков (как «Кому предоплата»).
-- Выполнить в Supabase SQL Editor целиком (одна команда).
-- Таблица excesses уже должна существовать.

ALTER TABLE public.excesses
  ADD COLUMN IF NOT EXISTS paid_to text;
