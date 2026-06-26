-- 0176_qr_codes_styling.sql
-- Add visual styling to QR codes: shape (square/round), dot + corner styles,
-- colors/gradient (stored as jsonb), and an optional center logo. The logo is
-- a data URL (or external URL) kept inline; volume is low so no storage bucket.

alter table qr_codes
  add column if not exists style jsonb not null default '{}'::jsonb,
  add column if not exists logo_url text;

notify pgrst, 'reload schema';
