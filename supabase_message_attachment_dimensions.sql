-- Размеры фото в сообщениях чата (для стабильной высоты пузыря до загрузки).
-- Выполнить в Supabase → SQL Editor после supabase_message_attachments.sql.

ALTER TABLE public.user_messages
  ADD COLUMN IF NOT EXISTS attachment_width integer,
  ADD COLUMN IF NOT EXISTS attachment_height integer;

COMMENT ON COLUMN public.user_messages.attachment_width IS
  'Ширина вложенного фото в пикселях (после сжатия); для резерва места в ленте';
COMMENT ON COLUMN public.user_messages.attachment_height IS
  'Высота вложенного фото в пикселях (после сжатия); для резерва места в ленте';

ALTER TABLE public.group_messages
  ADD COLUMN IF NOT EXISTS attachment_width integer,
  ADD COLUMN IF NOT EXISTS attachment_height integer;

COMMENT ON COLUMN public.group_messages.attachment_width IS
  'Ширина вложенного фото в пикселях (после сжатия); для резерва места в ленте';
COMMENT ON COLUMN public.group_messages.attachment_height IS
  'Высота вложенного фото в пикселях (после сжатия); для резерва места в ленте';
