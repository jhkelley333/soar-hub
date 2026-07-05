-- 0208_territory_map_shares.sql
-- Public share links for the Territory Map. Token-in-URL (same pattern as
-- the vendor QR portal): the viewer needs no login and sees exactly the
-- stores the link's CREATOR can see, resolved live at request time — an
-- RVP's link shows their region, a DO's their district. Revocation kills
-- the link immediately.

create table if not exists territory_map_shares (
  id           uuid        primary key default gen_random_uuid(),
  token        text        not null unique,
  created_by   uuid        not null references profiles(id) on delete cascade,
  is_active    boolean     not null default true,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists territory_map_shares_creator_idx
  on territory_map_shares (created_by);

-- Service-role gatekeeper pattern: RLS on, no policies — only the Netlify
-- functions (service key) touch this table.
alter table territory_map_shares enable row level security;

notify pgrst, 'reload schema';
