-- 0162_doc_version_index_status.sql
--
-- Indexing a large manual PDF can take far longer than a synchronous Netlify
-- function allows (~10s → 502). Indexing now runs in a *background* function
-- (15-min budget), which can't return its result to the browser — so the
-- doc_versions row carries live status the client polls instead.
--
--   index_status : 'idle' | 'indexing' | 'done' | 'error'
--   index_error  : failure reason when status = 'error'
--   index_chunks : section count on success (for the toast)
--
-- indexed_at remains the canonical "this version is searchable" signal;
-- index_status just tracks the in-flight job.

alter table doc_versions
  add column if not exists index_status text    not null default 'idle',
  add column if not exists index_error  text,
  add column if not exists index_chunks integer;
