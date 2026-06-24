-- 0002_add_medusa_order_id.sql
-- Run in Supabase Dashboard → SQL Editor

alter table orders add column if not exists medusa_order_id text;

create index if not exists idx_orders_medusa_order_id on orders(medusa_order_id)
  where medusa_order_id is not null;
