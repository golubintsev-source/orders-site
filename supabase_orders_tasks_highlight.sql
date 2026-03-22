-- Выделение заказа в колонке «Номер» (красная полоса сверху) при включённом «Выделить» на странице Задачи.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tasks_highlight boolean NOT NULL DEFAULT false;
