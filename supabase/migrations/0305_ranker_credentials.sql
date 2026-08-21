-- 0305_ranker_credentials.sql
-- Admin-only credential vault for the Ranker's external data sources (the
-- shared logins used to pull IX / EcoSure / KnowledgeForce / Qualtrics / RAP /
-- Skunkworks, etc.). Lives on the Ranker System-settings tab, which is already
-- admin-only. RLS restricts BOTH read and write to admins as defense in depth;
-- the Netlify function additionally gates on the admin role.
--
-- Security note: passwords are stored as text (encrypted at rest by the
-- database, not application-encrypted). Access is admin-only. Treat this as a
-- shared-login vault, not a secrets manager — don't put anything here that
-- shouldn't be visible to every admin.

create table if not exists public.ranker_credentials (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  url         text,
  username    text,
  password    text,
  notes       text,
  sort_order  int  not null default 100,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);

alter table public.ranker_credentials enable row level security;

-- Admins only, for read and write (these are secrets).
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'ranker_credentials_admin_all') then
    create policy ranker_credentials_admin_all on public.ranker_credentials
      for all using (is_admin()) with check (is_admin());
  end if;
end$$;

-- Seed the known sources with their URLs; usernames/passwords are left blank
-- for an admin to fill in. Skunkworks has no public URL — fill it in-app.
-- Only seeds on first run (when the table is empty), so re-applying is a no-op.
insert into public.ranker_credentials (label, url, sort_order)
select v.label, v.url, v.sort_order
from (values
  ('Skunkworks (KPI feed)',         null::text,                              10),
  ('Inventory Expressway',          'https://www.expresswaytech.com/',       20),
  ('EcoSure — Food Safety',         'https://account.ecolab.com/',           30),
  ('KnowledgeForce (Mystery Shops)','https://knowledgeforce.com/',           40),
  ('Qualtrics — Voice of Guest',    'https://inspirebrands.qualtrics.com/',  50),
  ('RAP / Sonic (OTT · Late Sends)','https://rap.sonicdrivein.com',          60)
) as v(label, url, sort_order)
where not exists (select 1 from public.ranker_credentials);

notify pgrst, 'reload schema';
