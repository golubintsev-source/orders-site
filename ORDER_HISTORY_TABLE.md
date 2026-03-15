# Таблица истории заказов (order_history)

Создайте в Supabase таблицу со следующими полями:

| Поле         | Тип         | Ограничения                    | Описание                    |
|-------------|-------------|--------------------------------|-----------------------------|
| **id**      | `int8`      | PRIMARY KEY, GENERATED ALWAYS AS IDENTITY | Уникальный идентификатор записи |
| **order_id**| `int8`      | NOT NULL, REFERENCES orders(id) ON DELETE CASCADE | ID заказа                  |
| **created_at** | `timestamptz` | DEFAULT now()              | Дата и время события        |
| **user_email** | `text`     |                                | Логин (email) пользователя  |
| **comment** | `text`      |                                | Комментарий (например: «Заказ создан») |

## SQL для создания таблицы (Supabase SQL Editor)

```sql
create table order_history (
  id bigint primary key generated always as identity,
  order_id bigint not null references orders(id) on delete cascade,
  created_at timestamptz default now(),
  user_email text,
  comment text
);

-- Индекс для быстрой выборки по заказу
create index order_history_order_id_idx on order_history(order_id);

-- RLS: разрешить чтение и вставку аутентифицированным пользователям
alter table order_history enable row level security;

create policy "Authenticated can read order_history"
  on order_history for select
  to authenticated using (true);

create policy "Authenticated can insert order_history"
  on order_history for insert
  to authenticated with check (true);
```

После создания таблицы и политик RLS страница «История» и запись при создании заказа будут работать.
