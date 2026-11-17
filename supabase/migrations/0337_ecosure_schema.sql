-- 0337_ecosure_schema.sql
-- EcoSure TrueView assessment and findings tables with RLS and scrapekit loaders.

-- ─────────────────────────────────────────────────────────────────────────────
-- ecosure_assessments  (one row per assessment; upsert on store+date+visit_type)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.ecosure_assessments (
  id               uuid    primary key default gen_random_uuid(),
  store_number     text    not null,
  assessment_date  date    not null,
  visit_type       text    not null,          -- "1 - Routine" / "2 - Re-Audit"
  visit_score      numeric,                   -- e.g. 87.18
  visit_rating     text,                      -- "Low Risk" / "Moderate Risk" / "High Risk"
  total_findings   int,
  imminent_risk    int,
  critical_findings int,
  major_findings   int,
  minor_findings   int,
  category_score   numeric,
  category_rating  text,
  report_url       text,                      -- PDF on analyticsdocs.trueview.ecosure.com
  l3_entity        text,                      -- SOAR ownership entity (L3 Name)
  l4_market        text,                      -- market / city (L4 Name)
  pulled_at        timestamptz not null default now(),
  constraint ecosure_assessments_uniq unique (store_number, assessment_date, visit_type)
);

create index if not exists ecosure_assessments_store_idx on public.ecosure_assessments (store_number);
create index if not exists ecosure_assessments_date_idx  on public.ecosure_assessments (assessment_date desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- ecosure_assessments_history  (append-only change log)
-- A row is appended whenever the upsert loader changes score, rating, or
-- finding counts on an existing assessment row.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.ecosure_assessments_history (
  id               uuid    primary key default gen_random_uuid(),
  assessment_id    uuid    not null references public.ecosure_assessments(id),
  store_number     text    not null,
  assessment_date  date    not null,
  visit_type       text    not null,
  visit_score      numeric,
  visit_rating     text,
  total_findings   int,
  imminent_risk    int,
  critical_findings int,
  major_findings   int,
  minor_findings   int,
  category_score   numeric,
  category_rating  text,
  report_url       text,
  pulled_at        timestamptz not null default now()
);

create index if not exists ecosure_assessments_history_asmnt_idx
  on public.ecosure_assessments_history (assessment_id);
create index if not exists ecosure_assessments_history_store_idx
  on public.ecosure_assessments_history (store_number, assessment_date desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- ecosure_findings  (Standard Details — one row per finding per assessment)
-- dedupe key: store + date + question_number + md5(pdc_response || pdc_comment)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.ecosure_findings (
  id                   uuid    primary key default gen_random_uuid(),
  store_number         text    not null,
  assessment_date      date    not null,
  question_number      text    not null,     -- e.g. "CS.2", "TT.1"
  standard_description text,
  primary_response     text,                 -- "No" or "Cured in the moment"
  primary_comment      text,
  pdc_response         text,
  pdc_comment          text,
  pdc_hash             text generated always as (
                         md5(coalesce(pdc_response, '') || coalesce(pdc_comment, ''))
                       ) stored,
  pulled_at            timestamptz not null default now(),
  constraint ecosure_findings_dedup unique (store_number, assessment_date, question_number, pdc_hash)
);

create index if not exists ecosure_findings_store_idx    on public.ecosure_findings (store_number);
create index if not exists ecosure_findings_date_idx     on public.ecosure_findings (assessment_date desc);
create index if not exists ecosure_findings_question_idx on public.ecosure_findings (question_number);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: authenticated / anon users cannot touch these tables directly.
-- service_role bypasses RLS; Netlify functions use the service-role key.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.ecosure_assessments         enable row level security;
alter table public.ecosure_assessments_history enable row level security;
alter table public.ecosure_findings            enable row level security;
-- No policies → only service_role can read/write.

-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER loader: assessments
-- Validates shape, upserts, writes history rows on change.
-- Callable only by service_role (public execute revoked below).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.scrapekit_ecosure_upsert_assessments(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r          jsonb;
  v_existing public.ecosure_assessments%rowtype;
  ins_count  int := 0;
  upd_count  int := 0;
  hist_count int := 0;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  for r in select jsonb_array_elements(p_rows) loop
    -- Look for an existing row
    select * into v_existing
    from ecosure_assessments
    where store_number    = r->>'store_number'
      and assessment_date = (r->>'assessment_date')::date
      and visit_type      = r->>'visit_type';

    if found then
      -- Append a history snapshot if score, rating, or finding counts changed
      if v_existing.visit_score    is distinct from (r->>'visit_score')::numeric
      or v_existing.visit_rating   is distinct from r->>'visit_rating'
      or v_existing.total_findings is distinct from (r->>'total_findings')::int then
        insert into ecosure_assessments_history (
          assessment_id, store_number, assessment_date, visit_type,
          visit_score, visit_rating, total_findings, imminent_risk,
          critical_findings, major_findings, minor_findings,
          category_score, category_rating, report_url, pulled_at
        ) values (
          v_existing.id,
          v_existing.store_number, v_existing.assessment_date, v_existing.visit_type,
          v_existing.visit_score, v_existing.visit_rating, v_existing.total_findings,
          v_existing.imminent_risk, v_existing.critical_findings,
          v_existing.major_findings, v_existing.minor_findings,
          v_existing.category_score, v_existing.category_rating,
          v_existing.report_url, now()
        );
        hist_count := hist_count + 1;
      end if;
      upd_count := upd_count + 1;
    else
      ins_count := ins_count + 1;
    end if;

    insert into ecosure_assessments (
      store_number, assessment_date, visit_type,
      visit_score, visit_rating,
      total_findings, imminent_risk, critical_findings, major_findings, minor_findings,
      category_score, category_rating, report_url, l3_entity, l4_market, pulled_at
    ) values (
      r->>'store_number',
      (r->>'assessment_date')::date,
      r->>'visit_type',
      (r->>'visit_score')::numeric,
      r->>'visit_rating',
      (r->>'total_findings')::int,
      (r->>'imminent_risk')::int,
      (r->>'critical_findings')::int,
      (r->>'major_findings')::int,
      (r->>'minor_findings')::int,
      (r->>'category_score')::numeric,
      r->>'category_rating',
      r->>'report_url',
      r->>'l3_entity',
      r->>'l4_market',
      coalesce((r->>'pulled_at')::timestamptz, now())
    )
    on conflict on constraint ecosure_assessments_uniq do update set
      visit_score       = excluded.visit_score,
      visit_rating      = excluded.visit_rating,
      total_findings    = excluded.total_findings,
      imminent_risk     = excluded.imminent_risk,
      critical_findings = excluded.critical_findings,
      major_findings    = excluded.major_findings,
      minor_findings    = excluded.minor_findings,
      category_score    = excluded.category_score,
      category_rating   = excluded.category_rating,
      report_url        = excluded.report_url,
      l3_entity         = excluded.l3_entity,
      l4_market         = excluded.l4_market,
      pulled_at         = excluded.pulled_at;
  end loop;

  return jsonb_build_object('inserted', ins_count, 'updated', upd_count, 'history', hist_count);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER loader: findings
-- Upserts on the dedup constraint (store+date+question+pdc_hash).
-- Manager Name from Non Scored Finding is excluded on the scrapekit side.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.scrapekit_ecosure_upsert_findings(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted int;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  insert into ecosure_findings (
    store_number, assessment_date, question_number,
    standard_description, primary_response, primary_comment,
    pdc_response, pdc_comment, pulled_at
  )
  select
    r->>'store_number',
    (r->>'assessment_date')::date,
    r->>'question_number',
    r->>'standard_description',
    r->>'primary_response',
    r->>'primary_comment',
    r->>'pdc_response',
    r->>'pdc_comment',
    coalesce((r->>'pulled_at')::timestamptz, now())
  from jsonb_array_elements(p_rows) as r
  on conflict on constraint ecosure_findings_dedup do update set
    standard_description = excluded.standard_description,
    primary_response     = excluded.primary_response,
    primary_comment      = excluded.primary_comment,
    pdc_response         = excluded.pdc_response,
    pdc_comment          = excluded.pdc_comment,
    pulled_at            = excluded.pulled_at;

  get diagnostics inserted = row_count;
  return jsonb_build_object('upserted', inserted);
end;
$$;

-- Only service_role may call these functions.
revoke execute on function public.scrapekit_ecosure_upsert_assessments(jsonb) from public;
revoke execute on function public.scrapekit_ecosure_upsert_findings(jsonb)    from public;
grant  execute on function public.scrapekit_ecosure_upsert_assessments(jsonb) to service_role;
grant  execute on function public.scrapekit_ecosure_upsert_findings(jsonb)    to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification
-- ─────────────────────────────────────────────────────────────────────────────
select
  relname        as table_name,
  relrowsecurity as rls_enabled
from pg_class
where relname in ('ecosure_assessments', 'ecosure_assessments_history', 'ecosure_findings')
  and relnamespace = 'public'::regnamespace
order by relname;

select proname, prosecdef as security_definer
from pg_proc
where proname in ('scrapekit_ecosure_upsert_assessments', 'scrapekit_ecosure_upsert_findings')
  and pronamespace = 'public'::regnamespace;
