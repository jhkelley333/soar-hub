-- 0209_pl_statements.sql
-- Store P&L statements (income statements), uploaded per period from the
-- accounting side-by-side workbook. One row per store per period: the full
-- ordered line-item statement as jsonb plus extracted headline metrics
-- (Total Sales, Controllable Income $ / %, Gross Profit, EBITDA) for fast
-- list views. Re-uploading a period overwrites (Prelim -> Final).

create table if not exists pl_statements (
  id               uuid        primary key default gen_random_uuid(),
  store_number     text        not null,
  store_id         uuid        references stores(id) on delete set null,
  period_end       date        not null,
  period_label     text,
  is_final         boolean     not null default false,
  -- Ordered array of { label, amount, pct, total } — the whole statement.
  lines            jsonb       not null,
  total_sales      numeric(14,2),
  gross_profit     numeric(14,2),
  ci_amount        numeric(14,2),
  ci_pct           numeric(8,2),
  ebitda           numeric(14,2),
  uploaded_by      uuid        references profiles(id) on delete set null,
  uploaded_by_name text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (store_number, period_end)
);

create index if not exists pl_statements_period_idx on pl_statements (period_end);
create index if not exists pl_statements_store_idx  on pl_statements (store_number);

-- Service-role gatekeeper pattern: RLS on, no policies — only the Netlify
-- function (service key) reads/writes, and it scope-checks every call.
alter table pl_statements enable row level security;

notify pgrst, 'reload schema';
