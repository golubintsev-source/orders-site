-- Вложения (фото) в сообщениях чата.
-- Выполнить в Supabase → SQL Editor.
-- Файлы хранятся в том же bucket order-files по пути {userId}/messages/…

ALTER TABLE public.user_messages
  ADD COLUMN IF NOT EXISTS attachment_storage_path text,
  ADD COLUMN IF NOT EXISTS attachment_thumbnail_path text,
  ADD COLUMN IF NOT EXISTS attachment_mime_type text,
  ADD COLUMN IF NOT EXISTS attachment_file_name text,
  ADD COLUMN IF NOT EXISTS attachment_file_size bigint;

COMMENT ON COLUMN public.user_messages.attachment_storage_path IS
  'Путь к фото в bucket order-files (…/messages/…); полный файл';
COMMENT ON COLUMN public.user_messages.attachment_thumbnail_path IS
  'Путь к миниатюре в bucket order-files; полный файл — attachment_storage_path';

ALTER TABLE public.group_messages
  ADD COLUMN IF NOT EXISTS attachment_storage_path text,
  ADD COLUMN IF NOT EXISTS attachment_thumbnail_path text,
  ADD COLUMN IF NOT EXISTS attachment_mime_type text,
  ADD COLUMN IF NOT EXISTS attachment_file_name text,
  ADD COLUMN IF NOT EXISTS attachment_file_size bigint;

COMMENT ON COLUMN public.group_messages.attachment_storage_path IS
  'Путь к фото в bucket order-files (…/messages/…); полный файл';
COMMENT ON COLUMN public.group_messages.attachment_thumbnail_path IS
  'Путь к миниатюре в bucket order-files; полный файл — attachment_storage_path';
