-- 0268_pl_review_notes_append_log.sql
-- Turn P&L preliminary-review notes into an append-only log: each save is its
-- own timestamped, attributed entry instead of one editable row per author.
-- Drops the per-author uniqueness so a store/line can carry multiple notes from
-- the same person over time; authors edit/delete only their own entries.

alter table pl_review_notes
  drop constraint if exists pl_review_notes_period_end_store_number_author_id_line_key_key;

notify pgrst, 'reload schema';
