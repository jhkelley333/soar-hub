-- Separate warranty-document attachment on the manual equipment register,
-- alongside the existing receipt_url. The Add/Edit equipment modal offers
-- two independent file slots (receipt/invoice + warranty docs); the upload
-- endpoint routes to this column when kind = 'warranty'.

alter table public.equipment_register
  add column if not exists warranty_doc_url text;
