-- 0322_google_reviews.sql
-- Google Reviews module (Tier A — Google Places API). Two tables:
--   google_reviews          — the rolling sample of reviews the Places API
--                             returns (≤5 newest per place per refresh),
--                             deduped per (store, author, review_time).
--   google_review_snapshots — one row per (store, day) of the store's overall
--                             Google rating + total review count, so a rating
--                             trend builds over time from launch onward.
-- Access is via the service-role google-reviews function (role-gated there); no
-- RLS policies needed (service role bypasses RLS, anon never reads these).

create table if not exists google_reviews (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references stores(id) on delete cascade,
  author        text not null default 'Anonymous',
  rating        smallint check (rating between 1 and 5),
  body          text,
  review_time   timestamptz,       -- when the review was posted (from the feed)
  relative_time text,              -- "a week ago" etc., as Google phrased it
  language      text,
  captured_at   timestamptz not null default now(),
  unique (store_id, author, review_time)
);
create index if not exists google_reviews_store_idx on google_reviews (store_id);
create index if not exists google_reviews_time_idx  on google_reviews (review_time desc);
create index if not exists google_reviews_rating_idx on google_reviews (rating);

create table if not exists google_review_snapshots (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references stores(id) on delete cascade,
  captured_date date not null default (now() at time zone 'America/Chicago')::date,
  rating        numeric(2,1),      -- Google's overall rating for the place
  review_count  integer,           -- Google's total review count
  fetched_at    timestamptz not null default now(),
  unique (store_id, captured_date)
);
create index if not exists google_review_snapshots_store_idx on google_review_snapshots (store_id, captured_date desc);

alter table google_reviews          enable row level security;
alter table google_review_snapshots enable row level security;

notify pgrst, 'reload schema';
