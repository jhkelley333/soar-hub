-- 0333_rap_data_flag_seed.sql
-- Seeds the rap_data_beta feature flag (disabled by default).
INSERT INTO public.feature_flags (key, enabled, allowlist_stores, allowlist_user_ids, notes)
VALUES (
  'rap_data_beta',
  false,
  '{}',
  '{}',
  'Customer RAP Data module — admin beta. Flip enabled = true or add user IDs to allowlist to unlock.'
)
ON CONFLICT (key) DO NOTHING;
