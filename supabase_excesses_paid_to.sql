-- Поле «Кому» для излишков (как «Кому предоплата»). Выполнить в Supabase SQL Editor.
ALTER TABLE excesses
  ADD COLUMN IF NOT EXISTS paid_to text;
