-- 0260_ranking_ott_source.sql
-- New ranker upload source: 'ott' (On-Time Tickets / SOS / Late Sends). One row
-- per store, uploaded WTD and PTD, carrying % Late Sends over 8 Min (+ % On Time
-- Tickets, Avg SOS, Late Sends count). Widen the ranking_source_files source
-- check to allow it.

alter table ranking_source_files drop constraint if exists ranking_source_files_source_check;
alter table ranking_source_files add constraint ranking_source_files_source_check
  check (source in ('ix', 'ecosure', 'vog', 'shops', 'bsc', 'totzone', 'ott'));

notify pgrst, 'reload schema';
