-- 0003_widen_payment_method.sql
-- Run in Supabase Dashboard → SQL Editor

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_payment_method;

ALTER TABLE orders ADD CONSTRAINT chk_payment_method
CHECK (payment_method IN (
  'cod',
  'paid',
  'online',
  'cash_on_delivery',
  'Cash on Delivery',
  'Online Bank Transfer',
  'JazzCash',
  'Easypaisa',
  'AbhiPay',
  'bank_transfer',
  'prepaid'
));
