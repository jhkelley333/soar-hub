# Environment variables

Every environment variable the app reads, where it's set, and whether it's
required. Server vars live in **Netlify → Site settings → Environment
variables** (never committed). Frontend vars are the `VITE_*` ones, baked into
the client bundle at build time.

Legend: **R** required · **O** optional (has a default / feature-specific) ·
**A** auto-provided by Netlify.

## Core — Supabase
| Var | | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | R | Supabase project URL (frontend). |
| `VITE_SUPABASE_ANON_KEY` | R | Supabase anon key (frontend). |
| `SUPABASE_URL` | R* | Functions read `VITE_SUPABASE_URL` first, then this. |
| `SUPABASE_SERVICE_ROLE_KEY` | R | Service-role key for Netlify functions (also accepted as `SUPABASE_SERVICE_KEY`). **Secret.** |
| `SUPABASE_ANON_KEY` | O | Server-side anon key (where a non-elevated client is needed). |
| `SUPABASE_BUCKET` | O | Default storage bucket name (module buckets are named explicitly). |
| `VITE_GOOGLE_HOSTED_DOMAIN` | O | Restricts Google sign-in to a Workspace domain. |

## Netlify-provided (don't set by hand)
| Var | | Notes |
|---|---|---|
| `URL`, `DEPLOY_URL` | A | Site URL — used to build email/redirect links. |
| `CONTEXT`, `DEPLOY_ID` | A | Build context / deploy id. |
| `APP_URL` | O | Optional explicit app URL override. |

## Email — Resend
| Var | | Notes |
|---|---|---|
| `RESEND_API_KEY` | R | Required for any outbound email. **Secret.** |
| `RESEND_FROM_EMAIL` | O | Default From address (defaults to `notifications@mysoarhub.com`). |
| `RESEND_FROM_NAME` | O | Default From name. |
| `RESEND_REPLY_TO` | O | Default Reply-To. |
| `RESEND_INBOUND_DOMAIN` | O | Inbound/parse domain. |
| `RESEND_WEBHOOK_SECRET` | O | Verifies Resend webhook callbacks. **Secret.** |
| Per-module From names | O | `PAF_FROM_NAME`, `CASH_FROM_NAME`, `FACILITIES_FROM_NAME` / `FACILITIES_FROM_EMAIL`, `EMPLOYEE_ACTIONS_FROM_NAME`, `WALKTHROUGH_FROM_NAME`, `WORKSPACE_FROM_NAME` / `WORKSPACE_FROM_EMAIL` — override sender per module. |

## Google (Sheets / Drive / Maps)
| Var | | Notes |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | R† | Service-account JSON for Sheets/Drive reads (Labor, Ranker, Vendors, Resources). **Secret.** †Required for those features. |
| `GOOGLE_MAPS_API_KEY` | O | Maps. |
| `GOOGLE_GEOCODING_API_KEY` | O | Geocoding (store geofences). |
| `RESOURCES_ROOT_FOLDER_ID` | O | Drive root folder for the Resources library. |
| `VIDEOS_FOLDER_ID` / `VIDEO_FOLDER_ID` | O | Drive folder(s) for training videos. |
| `SOAR_METRICS_SHEET_ID` | O | Ranker metrics sheet. |
| `VENDOR_SHEET_ID` | O | Vendor import sheet. |

## Labor snapshot
| Var | | Notes |
|---|---|---|
| `LABOR_SHEET_ID` | O | Labor sheet id (has a default). |
| `LABOR_SHEET_TAB` | O | Tab name (default `Labor`). |
| `LABOR_SHEET_RANGE` | O | A1 range (default `A1:AB1000`). |
| `LABOR_POLL_TZ` | O | Business-hours TZ (default `America/Chicago`). |
| `LABOR_POLL_START_HOUR` / `LABOR_POLL_END_HOUR` | O | Poll window (default 4–23). |
| `LABOR_MISS_TOLERANCE_PTS` | O | Labor "miss" threshold in points (default 0.5). |

## Web push (PWA notifications)
| Var | | Notes |
|---|---|---|
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | O | VAPID keypair for push. **Private is secret.** |
| `VAPID_SUBJECT` | O | `mailto:` contact for push. |

## SMS — Telnyx (PAF "Text approver")
| Var | | Notes |
|---|---|---|
| `TELNYX_API_KEY` | O | API V2 key. Required for any outbound SMS. **Secret.** |
| `TELNYX_FROM_NUMBER` | O | Sender number in E.164 (e.g. `+14695551234`). Use this **or** `TELNYX_MESSAGING_PROFILE_ID`. |
| `TELNYX_MESSAGING_PROFILE_ID` | O | Messaging profile id — lets Telnyx pick a number on the profile. Alternative to `TELNYX_FROM_NUMBER`. |

Outbound only — no inbound webhook is used. Also gated behind the
`paf_text_approver` feature flag, and the approver's profile must have a
phone number on file.

## Legacy / misc
| Var | | Notes |
|---|---|---|
| `SMARTSHEET_TOKEN` / `SMARTSHEET_SHEET_ID` | O | Legacy Work Orders (pre-V2). **Token is secret.** |
| `TRAINING_CLOSEOUT_FORM_URL` | O | Link used by Employee Actions. |
| `ANTHROPIC_API_KEY` | O | AI-assisted feature(s). **Secret.** |

## Proposed (not yet set)
| Var | | Notes |
|---|---|---|
| `CRON_SECRET` | — | Planned shared secret to guard the internal/scheduled functions (`labor-snapshot`, `pm-spawner`, `workspace-schedules-sweep`, `chat-managed-sync`). See the security gap. |

> Notes: `R*` — required, but satisfied by the `VITE_`-prefixed sibling.
> Required/optional reflects code defaults; verify against the live Netlify
> config when in doubt. Never commit real secret values — `.env.example`
> carries placeholders only.
