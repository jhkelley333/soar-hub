-- 0311_roller_leaderboard.sql
-- Leaderboard for the RollerBuddy landing-page easter-egg game. Each submitted
-- run stores a display name, score, and chosen character. The public
-- roller-leaderboard function (service role) is the only reader/writer, so RLS
-- is on with no public policies.

create table if not exists public.roller_scores (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  score      integer not null check (score >= 0 and score <= 100000),
  character  text not null default 'buddy' check (character in ('buddy','tot')),
  created_at timestamptz not null default now()
);

create index if not exists roller_scores_score_idx on public.roller_scores (score desc);

alter table public.roller_scores enable row level security;
-- No policies: only the service-role Netlify function touches this table.

notify pgrst, 'reload schema';
