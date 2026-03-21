-- Миниатюры для order_files: выполнить в Supabase SQL Editor
-- После применения новые загрузки получат thumbnail_storage_path; старые записи останутся с NULL (превью из полного файла).

ALTER TABLE order_files
  ADD COLUMN IF NOT EXISTS thumbnail_storage_path text;

COMMENT ON COLUMN order_files.thumbnail_storage_path IS
  'Путь к мелкому превью в bucket order-files; полный файл — storage_path';
