-- Доставка/прочтение в групповых чатах (галочки в списке и буквы участников в диалоге).
-- Выполнить в Supabase → SQL Editor после supabase_group_chat_reads.sql.
--
-- last_delivered_at — сообщения с created_at <= этого момента считаются доставленными участнику.
-- last_read_at — то же для прочтения (уже было).
-- Участники чата могут читать статусы друг друга (иначе отправитель не увидит галочки).

ALTER TABLE public.group_chat_reads
  ADD COLUMN IF NOT EXISTS last_delivered_at timestamptz;

UPDATE public.group_chat_reads
SET last_delivered_at = last_read_at
WHERE last_delivered_at IS NULL
  AND last_read_at IS NOT NULL;

COMMENT ON COLUMN public.group_chat_reads.last_delivered_at IS
  'Момент, до которого пользователь получил сообщения группового чата на клиенте';

-- Было: SELECT только своей строки. Нужно: все участники чата видят статусы всех участников.
DROP POLICY IF EXISTS "group_chat_reads_select_own" ON public.group_chat_reads;
DROP POLICY IF EXISTS "group_chat_reads_select_member" ON public.group_chat_reads;
CREATE POLICY "group_chat_reads_select_member" ON public.group_chat_reads
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.group_chats g
      WHERE g.id = group_chat_reads.chat_id
        AND auth.uid() = ANY (g.member_ids)
    )
  );
