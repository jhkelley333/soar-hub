-- supabase/migrations/0037_email_templates.sql
--
-- Admin-editable email templates for the Work Orders V2 module.
--
-- Schema:
--   * `kind` is the unique event the template handles
--     ('submitted', 'approval_requested', 'approval_decided', …).
--   * `subject` + `body_html` are mustache-ish: {{var}} placeholders get
--     replaced by escapeHtml(value) at send-time in facilities-v2.js.
--   * `is_active` lets an admin temporarily turn a template off without
--     losing the body; the function falls back to its hardcoded default
--     in that case (so we can ship a template-broken-but-emails-still-
--     working state).
--
-- Idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING). Safe to re-run.

create table if not exists email_templates (
  id          uuid        primary key default gen_random_uuid(),
  kind        text        not null unique,
  subject     text        not null,
  body_html   text        not null,
  is_active   boolean     not null default true,
  updated_by  text,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index if not exists idx_email_templates_kind on email_templates (kind);

-- Auto-update updated_at on changes (reuses the function from 0036).
drop trigger if exists email_templates_updated_at on email_templates;
create trigger email_templates_updated_at
  before update on email_templates
  for each row execute function update_updated_at();

-- ── SEED: 'submitted' ─────────────────────────────────────────
insert into email_templates (kind, subject, body_html, is_active) values
('submitted',
  '[Work Order] New {{wo_number}} — Store {{store_number}}: {{asset_type}}',
$tmpl$<!DOCTYPE html>
<html><body style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:620px;margin:0 auto;padding:16px;">
<p>A new facilities work order was submitted.</p>
<table style="font-size:14px;border-collapse:collapse;margin:10px 0;">
  <tr><td style="padding:3px 8px;color:#666;">WO #</td><td style="padding:3px 8px;font-family:monospace;">{{wo_number}}</td></tr>
  <tr><td style="padding:3px 8px;color:#666;">Store</td><td style="padding:3px 8px;">{{store_number}} — {{store_name}}</td></tr>
  <tr><td style="padding:3px 8px;color:#666;">Asset</td><td style="padding:3px 8px;">{{asset_type}}</td></tr>
  <tr><td style="padding:3px 8px;color:#666;">Priority</td><td style="padding:3px 8px;">{{priority}}</td></tr>
  <tr><td style="padding:3px 8px;color:#666;">Submitted by</td><td style="padding:3px 8px;">{{submitted_by}}</td></tr>
</table>
<p><strong>Issue:</strong></p>
<p style="white-space:pre-wrap;color:#333;">{{issue_description}}</p>
<p style="margin-top:16px;"><a href="{{link}}" style="background:#2563eb;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-weight:600;">View in Work Orders V2 →</a></p>
<p style="font-size:11px;color:#999;margin-top:24px;border-top:1px solid #eee;padding-top:8px;">Sent automatically by SOAR Facilities V2.</p>
</body></html>$tmpl$, true)
on conflict (kind) do nothing;

-- ── SEED: 'approval_requested' ───────────────────────────────
insert into email_templates (kind, subject, body_html, is_active) values
('approval_requested',
  '[Work Order] Approval needed ({{approval_level}}) — {{wo_number}}',
$tmpl$<!DOCTYPE html>
<html><body style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:620px;margin:0 auto;padding:16px;">
<p><strong>Approval requested at tier:</strong> {{approval_level}}</p>
<table style="font-size:14px;border-collapse:collapse;margin:10px 0;">
  <tr><td style="padding:3px 8px;color:#666;">WO #</td><td style="padding:3px 8px;font-family:monospace;">{{wo_number}}</td></tr>
  <tr><td style="padding:3px 8px;color:#666;">Store</td><td style="padding:3px 8px;">{{store_number}} — {{store_name}}</td></tr>
  <tr><td style="padding:3px 8px;color:#666;">Asset</td><td style="padding:3px 8px;">{{asset_type}}</td></tr>
  <tr><td style="padding:3px 8px;color:#666;">Priority</td><td style="padding:3px 8px;">{{priority}}</td></tr>
  <tr><td style="padding:3px 8px;color:#666;">Submitted by</td><td style="padding:3px 8px;">{{submitted_by}}</td></tr>
</table>
<p><strong>Request notes:</strong></p>
<p style="white-space:pre-wrap;color:#333;">{{approval_request_notes}}</p>
<p style="margin-top:16px;"><a href="{{link}}" style="background:#2563eb;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-weight:600;">Review &amp; Approve →</a></p>
<p style="font-size:11px;color:#999;margin-top:24px;border-top:1px solid #eee;padding-top:8px;">Sent automatically by SOAR Facilities V2.</p>
</body></html>$tmpl$, true)
on conflict (kind) do nothing;

-- ── SEED: 'approval_decided' ─────────────────────────────────
insert into email_templates (kind, subject, body_html, is_active) values
('approval_decided',
  '[Work Order] Approval {{approval_status}} — {{wo_number}}',
$tmpl$<!DOCTYPE html>
<html><body style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:620px;margin:0 auto;padding:16px;">
<p>Your approval request was <strong>{{approval_status}}</strong> by {{approval_approved_by}}.</p>
<table style="font-size:14px;border-collapse:collapse;margin:10px 0;">
  <tr><td style="padding:3px 8px;color:#666;">WO #</td><td style="padding:3px 8px;font-family:monospace;">{{wo_number}}</td></tr>
  <tr><td style="padding:3px 8px;color:#666;">Store</td><td style="padding:3px 8px;">{{store_number}} — {{store_name}}</td></tr>
  <tr><td style="padding:3px 8px;color:#666;">Asset</td><td style="padding:3px 8px;">{{asset_type}}</td></tr>
  <tr><td style="padding:3px 8px;color:#666;">Tier</td><td style="padding:3px 8px;">{{approval_level}}</td></tr>
</table>
<p style="margin-top:16px;"><a href="{{link}}" style="background:#2563eb;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-weight:600;">View in Work Orders V2 →</a></p>
<p style="font-size:11px;color:#999;margin-top:24px;border-top:1px solid #eee;padding-top:8px;">Sent automatically by SOAR Facilities V2.</p>
</body></html>$tmpl$, true)
on conflict (kind) do nothing;

notify pgrst, 'reload schema';
