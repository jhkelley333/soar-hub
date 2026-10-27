-- 0325_obsession_config.sql
-- Creates the obsession_config table for the company-wide Obsession Metric feature.
-- Only one row is active at a time; admins set the metric, target, and date window.
-- All authenticated users can read; only admin can write.

CREATE TABLE obsession_config (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_key       text        NOT NULL,
  metric_label     text        NOT NULL,
  metric_direction text        NOT NULL DEFAULT 'higher' CHECK (metric_direction IN ('higher', 'lower')),
  metric_format    text        NOT NULL DEFAULT 'pct'    CHECK (metric_format    IN ('pct', 'dollars', 'score', 'number')),
  target_value     numeric     NOT NULL,
  baseline_value   numeric,
  start_date       date        NOT NULL,
  end_date         date        NOT NULL,
  is_active        boolean     NOT NULL DEFAULT true,
  headline         text,
  created_by_id    uuid        REFERENCES profiles(id),
  updated_by_id    uuid        REFERENCES profiles(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE obsession_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "obsession_read_authenticated"
  ON obsession_config FOR SELECT TO authenticated USING (true);

CREATE POLICY "obsession_admin_write"
  ON obsession_config FOR ALL TO authenticated
  USING     ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');
