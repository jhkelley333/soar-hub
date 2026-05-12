-- Ranker — AI summary cache. One row per (store_number, week). Generated
-- on demand by netlify/functions/ranker-summary, served from cache on
-- subsequent views. The netlify function performs scope + role checks
-- before reading or writing, so RLS here is intentionally minimal —
-- defense in depth, not the enforcement point.

create table if not exists public.ranker_ai_summaries (
  store_number text        not null,
  week         integer     not null check (week between 1 and 53),
  summary      text        not null,
  model        text,
  generated_by uuid        references public.profiles(id) on delete set null,
  generated_at timestamptz not null default now(),
  primary key (store_number, week)
);

comment on table public.ranker_ai_summaries is
  'Cached AI weekly summaries for the Ranker module. Keyed by (store_number, week). One row per combination, regenerated only on admin force-refresh.';

alter table public.ranker_ai_summaries enable row level security;

-- Authenticated users can read any cached summary. The Ranker UI only
-- requests summaries for stores the caller can already see (enforced by
-- the netlify function via user_visible_stores), and the cached text
-- itself is non-sensitive.
drop policy if exists "ranker_summaries_read_authenticated"
  on public.ranker_ai_summaries;
create policy "ranker_summaries_read_authenticated"
  on public.ranker_ai_summaries
  for select
  to authenticated
  using (true);

-- Writes only via service-role key (the netlify function). No insert/
-- update/delete policy for authenticated users.
