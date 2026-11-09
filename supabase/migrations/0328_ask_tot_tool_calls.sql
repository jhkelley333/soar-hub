-- 0328_ask_tot_tool_calls.sql
-- Extend ask_tot_log with tool tracking; add ask_tot_tool_calls audit table.

-- ── Extend ask_tot_log ───────────────────────────────────────────────────────
ALTER TABLE ask_tot_log
  ADD COLUMN IF NOT EXISTS conversation_id uuid,
  ADD COLUMN IF NOT EXISTS view_as_user_id uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS denied_topic text,
  ADD COLUMN IF NOT EXISTS tool_count int,
  ADD COLUMN IF NOT EXISTS latency_ms int,
  ADD COLUMN IF NOT EXISTS model text;

-- ── ask_tot_tool_calls ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ask_tot_tool_calls (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id     uuid        NOT NULL REFERENCES ask_tot_log(id) ON DELETE CASCADE,
  tool       text        NOT NULL,
  args       jsonb,
  row_count  int,
  error      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ask_tot_tool_calls_log_idx ON ask_tot_tool_calls (log_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE ask_tot_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ask_tot_tool_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ask_tot_log_insert_service"       ON ask_tot_log;
DROP POLICY IF EXISTS "ask_tot_log_select_admin"         ON ask_tot_log;
DROP POLICY IF EXISTS "ask_tot_tool_calls_insert_service" ON ask_tot_tool_calls;
DROP POLICY IF EXISTS "ask_tot_tool_calls_select_admin"   ON ask_tot_tool_calls;

CREATE POLICY "ask_tot_log_insert_service"
  ON ask_tot_log FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "ask_tot_log_select_admin"
  ON ask_tot_log FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "ask_tot_tool_calls_insert_service"
  ON ask_tot_tool_calls FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "ask_tot_tool_calls_select_admin"
  ON ask_tot_tool_calls FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ── Immutability: trigger blocks UPDATE / DELETE on both tables ───────────────
CREATE OR REPLACE FUNCTION ask_tot_immutable_check()
  RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ask_tot tables are immutable — updates and deletes are not allowed';
END;
$$;

DROP TRIGGER IF EXISTS ask_tot_log_no_mutate        ON ask_tot_log;
DROP TRIGGER IF EXISTS ask_tot_tool_calls_no_mutate ON ask_tot_tool_calls;

CREATE TRIGGER ask_tot_log_no_mutate
  BEFORE UPDATE OR DELETE ON ask_tot_log
  FOR EACH ROW EXECUTE FUNCTION ask_tot_immutable_check();

CREATE TRIGGER ask_tot_tool_calls_no_mutate
  BEFORE UPDATE OR DELETE ON ask_tot_tool_calls
  FOR EACH ROW EXECUTE FUNCTION ask_tot_immutable_check();

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'ask_tot_log' AND column_name IN ('conversation_id','tool_count','latency_ms','model')
--   ORDER BY column_name;
-- SELECT table_name FROM information_schema.tables WHERE table_name = 'ask_tot_tool_calls';
