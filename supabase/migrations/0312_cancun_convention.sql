-- 0312_cancun_convention.sql
-- Cancun Convention app (Beta) persistence. While the app is incubated inside
-- SoarHub, a convention "registration" is keyed to the signed-in SoarHub user.
-- cancun_profiles holds each user's brand + checklist + passport flag; the
-- Support leadership crew (cancun_contacts) is readable ONLY by a user who has
-- registered (brand set) for that brand — the gate, enforced by RLS.

create table if not exists public.cancun_profiles (
  user_id           uuid primary key references public.profiles(id) on delete cascade,
  full_name         text,
  brand             text check (brand in ('Apricus QSR','Mitra QSR','Prime QSR','SOAR QSR')),
  checklist         jsonb not null default '{}'::jsonb,
  passport_uploaded boolean not null default false,
  registered_at     timestamptz,
  updated_at        timestamptz not null default now()
);

alter table public.cancun_profiles enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'cancun_profiles_own') then
    create policy cancun_profiles_own on public.cancun_profiles for all
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end$$;

create table if not exists public.cancun_contacts (
  id        uuid primary key default gen_random_uuid(),
  brand     text not null check (brand in ('Apricus QSR','Mitra QSR','Prime QSR','SOAR QSR')),
  step      int not null,
  name      text not null,
  role      text not null,
  phone     text not null default '',
  is_active boolean not null default true
);

alter table public.cancun_contacts enable row level security;
-- Read gate: only a registered user, and only their own brand's crew. No client
-- write policy — admins manage the crew via service role / SQL.
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'cancun_contacts_registered_read') then
    create policy cancun_contacts_registered_read on public.cancun_contacts for select
      using (
        is_active and exists (
          select 1 from public.cancun_profiles p
          where p.user_id = auth.uid() and p.brand = cancun_contacts.brand
        )
      );
  end if;
end$$;

-- Seed placeholder crews (REPLACE the phone numbers with real data before
-- launch). Only seeds when the table is empty.
insert into public.cancun_contacts (brand, step, name, role, phone)
select v.brand, v.step, v.name, v.role, v.phone
from (values
  ('SOAR QSR',    1, 'Dana Whitfield',       'Direct Supervisor',  ''),
  ('SOAR QSR',    2, 'Marcus Reyes',         'Senior Leadership',  ''),
  ('SOAR QSR',    3, 'SOAR Leadership Line',  '24-hour escalation', ''),
  ('Mitra QSR',   1, 'Priya Anand',          'Direct Supervisor',  ''),
  ('Mitra QSR',   2, 'Tom Bex',              'Senior Leadership',  ''),
  ('Mitra QSR',   3, 'Mitra Leadership Line', '24-hour escalation', ''),
  ('Apricus QSR', 1, 'Luis Ortega',          'Direct Supervisor',  ''),
  ('Apricus QSR', 2, 'Karen Doss',           'Senior Leadership',  ''),
  ('Apricus QSR', 3, 'Apricus Leadership Line','24-hour escalation', ''),
  ('Prime QSR',   1, 'Renee Colbert',        'Direct Supervisor',  ''),
  ('Prime QSR',   2, 'Andre Salas',          'Senior Leadership',  ''),
  ('Prime QSR',   3, 'Prime Leadership Line', '24-hour escalation', '')
) as v(brand, step, name, role, phone)
where not exists (select 1 from public.cancun_contacts);

notify pgrst, 'reload schema';
