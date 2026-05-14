-- supabase/migrations/0044_vendor_qr_portal.sql
--
-- Adds the schema for the anonymous Vendor QR Portal — a stopgap
-- before the full v3 vendor experience. Pattern:
--   1. Admin generates a long random token per store (this migration's
--      store_qr_tokens table). Token is printed on a sticker as a QR
--      code and posted on the store wall.
--   2. Vendor scans the QR → opens /v/<token> on their phone.
--   3. Anonymous endpoint resolves the token to a store, shows the
--      open tickets at that store, lets the vendor self-identify and
--      take a forward-only action: Mark On Site, Mark Completed,
--      Submit Quote, Upload Photo.
--   4. Each action is logged to vendor_visits with the self-attested
--      identity + IP + UA so we have an audit trail even without
--      authenticated vendor accounts.
--
-- Tokens are:
--   * Revocable (is_active flag).
--   * Time-bound (expires_at, default 365 days).
--   * Re-issuable (admin can rotate without changing the store).
--
-- No FK from vendor_visits to any tickets table column because a
-- visit can predate the ticket it acts on (vendor scans, picks the
-- ticket from a list). FK is set explicitly when an action targets
-- a specific ticket.
--
-- Idempotent. Run on Soar Hub v2.

-- ── 1. store_qr_tokens ─────────────────────────────────────────
create table if not exists store_qr_tokens (
  id             uuid        primary key default gen_random_uuid(),
  store_number   text        not null,
  -- Long random string. Stored as text since we look up by exact
  -- match. URL-safe alphabet, 32 chars (~190 bits of entropy).
  token          text        not null unique,
  label          text,        -- optional human label, e.g. "back-of-house sticker"
  is_active      boolean     not null default true,
  expires_at     timestamptz,
  created_by_id  uuid        references profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  revoked_at     timestamptz,
  revoked_by_id  uuid        references profiles(id) on delete set null
);

create index if not exists idx_store_qr_tokens_store
  on store_qr_tokens(store_number) where is_active;

create index if not exists idx_store_qr_tokens_token
  on store_qr_tokens(token);

-- ── 2. vendor_visits ───────────────────────────────────────────
create table if not exists vendor_visits (
  id              uuid        primary key default gen_random_uuid(),
  token_id        uuid        not null references store_qr_tokens(id) on delete cascade,
  ticket_id       uuid        references tickets(id) on delete set null,
  -- Self-attested identity at the time of the action. Captured once
  -- per device, sent with every action. NEVER authoritative.
  vendor_name     text,
  vendor_company  text,
  vendor_phone    text,
  action          text        not null,  -- 'view' | 'on_site' | 'completed' | 'quote_submitted' | 'photo_added'
  notes           text,
  -- Soft audit: best-effort IP from x-forwarded-for, user-agent
  -- string. Useful for spotting abuse, not for legal-grade audit.
  remote_ip       text,
  user_agent      text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_vendor_visits_token
  on vendor_visits(token_id, created_at desc);

create index if not exists idx_vendor_visits_ticket
  on vendor_visits(ticket_id, created_at desc) where ticket_id is not null;

-- ── 3. Convenience: helper to mint a token ─────────────────────
-- Generates a 32-char URL-safe random string. Used by the admin
-- backend to create a new token row without app-side crypto.
create or replace function gen_store_qr_token()
returns text
language sql
volatile
as $$
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789',
           (floor(random() * 53) + 1)::int, 1),
    ''
  )
  from generate_series(1, 32);
$$;

notify pgrst, 'reload schema';
