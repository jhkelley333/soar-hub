-- 0326_comms_board_meta.sql
-- Per-store per-period editable fields for the Communication Board.

CREATE TABLE public.comms_board_meta (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_number text       NOT NULL,
  period      integer     NOT NULL CHECK (period BETWEEN 1 AND 13),
  field       text        NOT NULL CHECK (field IN (
    'employee_of_month',
    'new_team_members',
    'birthdays_this_month',
    'current_promotions',
    'top_3_food_variances'
  )),
  value       text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (store_number, period, field)
);

ALTER TABLE public.comms_board_meta ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read (page-level access is enforced in the app).
CREATE POLICY "comms_meta_select" ON public.comms_board_meta
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Any authenticated user can write (store access enforced at app level).
CREATE POLICY "comms_meta_insert" ON public.comms_board_meta
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "comms_meta_update" ON public.comms_board_meta
  FOR UPDATE USING (auth.uid() IS NOT NULL);

CREATE INDEX ON public.comms_board_meta (store_number, period);
