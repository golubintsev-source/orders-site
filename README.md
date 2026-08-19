# Заявки

Сайт заявок с авторизацией и базой Supabase.

## Структура проекта

```
orders-site/
├── index.html      # основная страница
├── login.html      # страница входа
├── style.css       # стили
├── js/             # скрипты
│   ├── main.js
│   ├── auth.js
│   ├── config.js
│   ├── dom.js
│   ├── files.js
│   ├── orders.js
│   ├── state.js
│   └── ui.js
└── login.js
```

## Supabase: миниатюры файлов (`order_files`)

Для превью в списках без загрузки полного фото в таблицу `order_files` нужна колонка `thumbnail_storage_path`. Выполни SQL из файла **`supabase_order_files_thumbnail.sql`** в **Supabase → SQL Editor**. Без этого шага вставка новых файлов из формы может завершиться ошибкой.

Старые записи без миниатюры по-прежнему показывают превью по полному файлу (как раньше).

## Supabase: идемпотентность создания заказов

Чтобы при повторных кликах по кнопке «Сохранить заказ» (например, после сетевых таймаутов) не создавались дубликаты строк в таблице `orders`, выполни SQL из файла **`supabase_orders_save_idempotency_key.sql`** в **Supabase → SQL Editor**.

Чтобы также не плодились одинаковые записи в `order_history` и авто-дельты в `calculations`, дополнительно выполни:
- **`supabase_order_history_dedup_unique.sql`**
- **`supabase_calculations_dedup_unique_comment.sql`**

## Supabase: фото в сообщениях чата

Чтобы прикреплять фото в чате, выполни SQL из файла **`supabase_message_attachments.sql`** в **Supabase → SQL Editor**. Фото сохраняются в bucket `order-files` по пути `{userId}/messages/…` с теми же правилами сжатия и миниатюр, что и файлы заявок.

## Supabase: ответ / изменение / удаление сообщений

Чтобы в чате работали долгое нажатие и меню «Ответить / Изменить / Удалить», выполни SQL из файла **`supabase_message_actions.sql`** в **Supabase → SQL Editor**. Добавляются колонки `reply_to_id`, `edited_at`, `deleted_at` и политики обновления для отправителя.

## Supabase: галочки доставки/прочтения в групповых чатах

Чтобы в групповых чатах показывались галочки (в списке чатов — когда все получили / все прочитали; в диалоге — буква участника и 0/1/2 галочки), выполни SQL из файла **`supabase_group_chat_receipts.sql`** в **Supabase → SQL Editor** (после `supabase_group_chat_reads.sql`). Добавляется колонка `last_delivered_at` и политика SELECT для участников чата.

## Supabase: статистика баланса

Снимки строки «Сейчас» при открытии «Баланс» пишутся в **`site_access_logs`** (путь `/balance-snapshot?…`) — ту же таблицу, что и раздел «Статистика». Отдельный SQL для баланса не нужен, если уже выполнен **`supabase_site_access_logs.sql`**.

Файл `supabase_balance_view_logs.sql` больше не используется приложением (можно не выполнять).

## Как залить на GitHub

### 1. Установи Git (если ещё нет)

Скачай и установи: https://git-scm.com/download/win

### 2. Открой терминал в папке проекта

В Cursor: **Terminal → New Terminal** (или PowerShell / cmd, перейди в папку `orders-site`).

### 3. Инициализация репозитория и первый коммит

```bash
git init
git add .
git commit -m "Первый коммит: заявки с Supabase"
```

Команда `git add .` добавляет **все файлы**, в том числе папку `js` со всеми файлами внутри.

### 4. Создай репозиторий на GitHub

- Зайди на https://github.com → **New repository**
- Имя, например: `orders-site`
- **Не** ставь галочку "Add a README" (у тебя уже есть файлы)
- Нажми **Create repository**

### 5. Подключи удалённый репозиторий и отправь код

GitHub покажет команды. Обычно это:

```bash
git remote add origin https://github.com/ТВОЙ_ЛОГИН/orders-site.git
git branch -M main
git push -u origin main
```

Подставь свой логин GitHub вместо `ТВОЙ_ЛОГИН`.

---

После этого на GitHub будут все файлы: и `index.html`, и папка `js` со всеми скриптами. Структура с папкой `js` — правильная, так и оставляй.
