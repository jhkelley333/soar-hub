-- supabase/migrations/0160_seed_paf_text_approver_flag.sql
--
-- Seed the feature flag for the PAF "Text approver" SMS nudge (Telnyx).
-- Disabled globally until Telnyx is fully set up (TELNYX_API_KEY + a
-- sender number in Netlify, DKIM/number verified). Preview it by adding
-- your own profile id to allowlist_user_ids via Admin → Feature Flags,
-- then flip `enabled` to true once it's signed off.

insert into feature_flags (key, enabled, notes)
values (
  'paf_text_approver',
  false,
  'PAF detail-drawer "Text approver" button — outbound SMS heads-up to the assigned approver via Telnyx. Enable globally once Telnyx is configured, or add your user id to the allowlist to preview.'
)
on conflict (key) do nothing;
