-- 0301_metric_definitions.sql
-- Phase 8A: a registry of plain-language metric definitions. One reusable info
-- tooltip reads from here, so a new "what does X mean?" request is a row insert,
-- not a code change. Authenticated-read, admin-write. RLS + policies in-file.

create table if not exists public.metric_definitions (
  key         text primary key,          -- stable slug, e.g. 'daily_completion'
  label       text not null,             -- display name, e.g. 'Daily Completion'
  definition  text not null,             -- plain-language explanation
  source      text,                      -- where the number comes from
  category    text,                      -- optional grouping (count / labor / …)
  sort_order  int  not null default 100,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);

alter table public.metric_definitions enable row level security;

create policy metric_definitions_read on public.metric_definitions
  for select using (auth.uid() is not null);
create policy metric_definitions_admin_write on public.metric_definitions
  for all using (is_admin()) with check (is_admin());

-- Seed the three definitions named in the brief (plus a couple of common ones).
insert into public.metric_definitions (key, label, definition, source, category, sort_order) values
  ('daily_completion', 'Daily Completion',
   'The share of required daily inventory counts that were completed on time. Higher is better — it shows the store is keeping up with its count cadence.',
   'Daily count feed', 'count', 10),
  ('accuracy_score', 'Accuracy',
   'How closely the counted inventory matched what the system expected. Higher = fewer miscounts or unexplained variances.',
   'Daily count feed', 'count', 20),
  ('steady_store', 'Steady store',
   'A store-stability tier: a store that performs consistently week to week with low volatility. Used to judge results fairly — a steady store and a turnaround store are not held to the same expectation.',
   'Ranker stability model', 'stability', 30)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
