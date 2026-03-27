-- Мягкое удаление строк «Расчёты» (автостроки не удаляются физически).
-- Выполнить в Supabase SQL Editor после основной таблицы calculations.

ALTER TABLE calculations
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

COMMENT ON COLUMN calculations.deleted_at IS 'Скрыта из интерфейса; запись остаётся в БД';

CREATE INDEX IF NOT EXISTS idx_calculations_active
  ON calculations (created_at DESC)
  WHERE deleted_at IS NULL;
