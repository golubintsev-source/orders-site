-- Исправление: широкий UNIQUE(comment) ломал ручное добавление на «Расчеты».
--
-- Этот скрипт ТОЛЬКО снимает вредный индекс.
--
-- Гарантии по данным:
--   ✅ DROP INDEX — удаляется только индекс, строки calculations не трогаются
--   ❌ Нет DELETE / TRUNCATE / DROP TABLE
--   ❌ Нет UPDATE строк (в т.ч. deleted_at)
--
-- Скрипт можно выполнять повторно.
-- Для исправления ошибки добавления достаточно этого файла
-- (или sql/calculations_dedup_drop_comment_unique.sql — то же самое).
--
-- Опционально (антидубли авто-дельт через soft-delete + узкий UNIQUE):
--   sql/calculations_auto_comment_unique_optional.sql

DROP INDEX IF EXISTS calculations_comment_uq;
