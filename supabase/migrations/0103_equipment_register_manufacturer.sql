-- Manufacturer (brand) on the equipment register, distinct from supplier
-- (who you bought it from). Today the brand is jammed into the free-text
-- model/SKU ("Avantco APT-48M-HC…"); this gives it its own field so it can
-- be shown + searched on its own and used for warranty / parts contacts.

alter table public.equipment_register
  add column if not exists manufacturer text;
