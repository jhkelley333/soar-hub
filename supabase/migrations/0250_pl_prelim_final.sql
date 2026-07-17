-- 0250_pl_prelim_final.sql
-- Keep BOTH the Preliminary and Final P&L per store/period so they can be
-- compared side-by-side. Previously unique(store_number, period_end) meant a
-- Final upload overwrote the Prelim row. Now the two stages (is_final = false
-- / true) coexist: unique(store_number, period_end, is_final). Re-uploading a
-- given stage still overwrites that same stage.

-- Drop the old 2-column unique (store_number, period_end). Migration 0209
-- created it inline, so Postgres named it deterministically. The DO block is a
-- belt-and-suspenders fallback that finds any remaining unique on exactly those
-- two columns (attname cast to text so it compares to the text[] literal).
alter table public.pl_statements
  drop constraint if exists pl_statements_store_number_period_end_key;

do $$
declare
  v_conname text;
begin
  select con.conname into v_conname
  from pg_constraint con
  where con.conrelid = 'public.pl_statements'::regclass
    and con.contype = 'u'
    and (
      select array_agg(a.attname::text order by a.attname::text)
      from unnest(con.conkey) as k(attnum)
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
    ) = array['period_end', 'store_number']
  limit 1;
  if v_conname is not null then
    execute format('alter table public.pl_statements drop constraint %I', v_conname);
  end if;
end $$;

-- New 3-column unique: one Prelim + one Final per store/period.
create unique index if not exists pl_statements_store_period_stage_key
  on public.pl_statements (store_number, period_end, is_final);

notify pgrst, 'reload schema';
