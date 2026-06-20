-- 0177_qr_codes_kinds.sql
-- Let a QR do more than a plain URL: add a destination "kind" (url | email |
-- call | sms) plus a structured payload. The server resolves kind+payload into
-- the existing target_url (mailto:/tel:/sms:/https:) that the /q redirect 302s
-- to, so codes stay dynamic + editable regardless of type.

alter table qr_codes
  add column if not exists kind text not null default 'url',
  add column if not exists payload jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
