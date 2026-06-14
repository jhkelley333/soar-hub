-- 0156_manual_search_rpc.sql
-- Manual & Guide Search — Phase 3. Client-callable full-text search over ACTIVE
-- manual versions only.
--
-- SECURITY INVOKER (the default — we deliberately do NOT mark this definer) so
-- RLS on manuals / doc_versions / manual_chunks scopes results to the caller:
-- a store user only ever gets snippets from manuals their org scope allows.
--
-- For an invoker function the authenticated role needs table SELECT, so we grant
-- it explicitly here (RLS still gates rows). Reads only — write grants come with
-- the admin UI phase.

grant select on manuals, doc_versions, manual_chunks to authenticated;

create or replace function search_manuals(
  q text,
  manual_id uuid default null,
  max_results int default 20
)
returns table (
  chunk_id      uuid,
  manual_id     uuid,
  manual_title  text,
  section_path  text,
  version_label text,
  snippet       text,
  rank          real
)
language sql
stable
as $$
  select
    c.id,
    c.manual_id,
    m.title,
    c.section_path,
    v.version_label,
    ts_headline(
      'english',
      coalesce(c.heading, '') || ' ' || c.content,
      plainto_tsquery('english', q),
      'StartSel=<mark>,StopSel=</mark>,MaxFragments=2,MinWords=6,MaxWords=28,ShortWord=2'
    ),
    ts_rank(c.fts, plainto_tsquery('english', q))
  from manual_chunks c
  join doc_versions v on v.id = c.doc_version_id and v.is_active
  join manuals m      on m.id = c.manual_id
  where c.fts @@ plainto_tsquery('english', q)
    -- function-name-qualified param to disambiguate from the column/output name
    and (search_manuals.manual_id is null or c.manual_id = search_manuals.manual_id)
  order by 7 desc        -- ts_rank, highest first
  limit greatest(1, least(coalesce(max_results, 20), 100));
$$;

grant execute on function search_manuals(text, uuid, int) to authenticated;

notify pgrst, 'reload schema';
