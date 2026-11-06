-- 0327_ask_tot_log.sql
-- Creates the Ask Tot Q&A audit log table for the AI assistant beta.

create table if not exists public.ask_tot_log (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  user_id     uuid references auth.users(id) on delete set null,
  role        text,
  question    text,
  answer      text,
  sources     text[]
);

alter table public.ask_tot_log enable row level security;

-- Only admins can read the log via the app; the service role (backend) writes it.
create policy "admins_read_ask_tot_log"
  on public.ask_tot_log for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );
