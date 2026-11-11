-- 0332_security_advisor_fixes.sql
-- Fixes Supabase security advisor warnings: view SECURITY DEFINER, trigger functions and
-- auth-only functions callable by unauthenticated (anon) role via RPC.

-- ── 1. View: switch tp_nla_comparison to SECURITY INVOKER ────────────────────
-- Was implicitly SECURITY DEFINER (view owner), which bypasses RLS.
-- SECURITY INVOKER means the querying user's own privileges / RLS policies apply.
ALTER VIEW public.tp_nla_comparison SET (security_invoker = on);

-- ── 2. Trigger functions: revoke EXECUTE from public ─────────────────────────
-- These are called exclusively by DB triggers, never via /rest/v1/rpc/.
-- Revoking from PUBLIC removes the grant from both anon and authenticated.
REVOKE EXECUTE ON FUNCTION public._log_schedule_status_change() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()             FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_touch_thread()           FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_contact_change()          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_vendor_change()           FROM PUBLIC;

-- ── 3. Auth-only functions: revoke EXECUTE from anon ─────────────────────────
-- All of these require a valid session; anon has no business calling them.
-- Authenticated role retains EXECUTE so existing app logic is unaffected.
REVOKE EXECUTE ON FUNCTION public.activate_doc_version(uuid)                                FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_see_store(uuid)                                       FROM anon;
REVOKE EXECUTE ON FUNCTION public.chat_inbox_unread(uuid, text)                             FROM anon;
REVOKE EXECUTE ON FUNCTION public.chat_is_member(uuid, uuid)                               FROM anon;
REVOKE EXECUTE ON FUNCTION public.chat_org_roster(scope_type, uuid, user_role)             FROM anon;
REVOKE EXECUTE ON FUNCTION public.chat_reconcile_managed_group(uuid, uuid)                 FROM anon;
REVOKE EXECUTE ON FUNCTION public.chat_sync_managed_groups(uuid)                           FROM anon;
REVOKE EXECUTE ON FUNCTION public.current_user_role()                                       FROM anon;
REVOKE EXECUTE ON FUNCTION public.derive_reno_cohort()                                      FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_qr_scan(uuid)                                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_admin()                                                FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_payroll()                                              FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_workspace_member(uuid, uuid)                          FROM anon;
REVOKE EXECUTE ON FUNCTION public.manageable_users(uuid)                                   FROM anon;
REVOKE EXECUTE ON FUNCTION public.manual_can_manage()                                       FROM anon;
REVOKE EXECUTE ON FUNCTION public.qsr_assignments_for_user(uuid)                           FROM anon;
REVOKE EXECUTE ON FUNCTION public.qsr_can_author()                                          FROM anon;
REVOKE EXECUTE ON FUNCTION public.qsr_user_training_summary(uuid)                          FROM anon;
REVOKE EXECUTE ON FUNCTION public.reno_caller_role()                                        FROM anon;
REVOKE EXECUTE ON FUNCTION public.store_directory()                                         FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_visible_scope_ids(uuid, text)                       FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_visible_stores(uuid)                                FROM anon;
REVOKE EXECUTE ON FUNCTION public.walkthrough_caller_role()                                 FROM anon;
