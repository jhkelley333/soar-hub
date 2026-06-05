-- supabase/migrations/0126_capa_work_order_link.sql
--
-- Bridge walkthrough corrective actions → Work Orders. A corrective action
-- can spawn a real WO ticket (server creates it, pre-filled with the failed
-- item + photos); this column links the two so neither side is re-keyed and
-- the review UI can show "WO-#### created".
--
-- No enum change — safe single block.

alter table public.corrective_actions
  add column if not exists work_order_ticket_id uuid
    references public.tickets(id) on delete set null;

notify pgrst, 'reload schema';
