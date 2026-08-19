-- =============================================================================
-- Импорт снимка calculations из PITR / бэкапа во временную таблицу
--
-- Supabase Dashboard → Database → Backups → Point in Time Recovery
-- Восстановите на момент ДО запуска supabase_calculations_dedup_unique_comment.sql
-- (ориентир: 2026-08-19 до 18:27 MSK / 15:27 UTC).
--
-- После восстановления в отдельную ветку/проект экспортируйте calculations
-- или выполните на восстановленной БД блок «копирование» ниже, затем перенесите
-- данные в рабочий проект.
-- =============================================================================

DROP TABLE IF EXISTS calculations_before_dedup;

CREATE TABLE calculations_before_dedup (
  LIKE calculations INCLUDING ALL
);

-- Если PITR дал полную таблицу в той же БД (временная схема) — подставьте источник:
-- INSERT INTO calculations_before_dedup SELECT * FROM calculations;

-- Проверка
SELECT COUNT(*) AS rows_in_snapshot FROM calculations_before_dedup;

-- Дальше:
--   sql/calculations_dedup_list_deleted.sql
--   sql/calculations_dedup_restore_deleted.sql
--   sql/calculations_dedup_drop_comment_unique.sql
