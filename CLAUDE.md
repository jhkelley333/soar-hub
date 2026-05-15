# SOAR Hub — Claude Notes

## CRITICAL: Supabase project verification

**At the start of every session that involves Supabase / SQL / migrations, remind the user:**

> "Confirm you are connected to the **Soar Hub v2** project in Supabase before running any SQL. The account has multiple projects, including an older work-orders prototype with different tables."

How to verify:
- Open Supabase dashboard → top-left project switcher → must read **Soar Hub v2**.
- Spot-check: `select to_regclass('public.form_config');` returns `form_config` (not null) on the right project.

## Branch convention

Active feature branch: **`claude/paf-form`**. The user merges PRs from this branch into `main` manually via GitHub UI; there is no auto-merge automation.

## Patch ferry workflow

The harness git proxy CANNOT push to GitHub. All code lives in the user's local repo at `~/soar-hub` on their MacBook. To get my work to them:

1. Generate plain unified diff (NOT format-patch — SHA mismatches): `git diff HEAD~1 HEAD > /tmp/foo.patch`
2. Compress + base64: `gzip -9 -c /tmp/foo.patch | base64`
3. If >12 KB base64, split into chunks: `split -b 7000 /tmp/foo.b64 /tmp/foo.part.`
4. User pastes each chunk via `pbpaste > /tmp/foo.part.aa`, etc., then assembles with `cat ... | base64 -d | gunzip > /tmp/foo.patch`
5. User applies via `git apply /tmp/foo.patch` (NOT `git am` — different SHA semantics)
6. **Always print readable diff alongside the base64** so user can audit before applying

When the patch fails because the user's tree drifted from sandbox, fall back to a Python script that does explicit string replacements. Don't fight `git am` — it's brittle on this setup.

## What's shipped on `main` as of last session

| Feature | Status |
|---|---|
| PR A — PAF Tier-1 admin config (`/admin/paf-config`) | merged |
| PR B-1 — Core PAF flow (submit, list, queue, token-approve) | merged |
| B-2a — Login hang fix (8s timeout, sb-* token purge, cache headers) | merged |
| B-2b — Form revisions: Pay Basis, Transfer, Demotion, Bonus consolidation, SDO approval workflow | merged |
| Bonus refinements — hidden Pay Basis on Bonus, locked referral amount, training start/end dates | merged |
| GM access removed from PAF | merged |
| Resend email integration | merged |
| Queue UX — sort columns, status filter chips, search, audit timeline, sidebar pending badge | merged |
| CSV export + slide-out drawer + mobile form polish | merged |
| Drawer action buttons (Reject/Process/etc inside drawer) | merged |
| Approval stepper + upcoming queue + drive-in dropdown | merged |
| SDOs see DOs in My Team (migration 0022) | merged |

## Migrations applied to Soar Hub v2

| # | What | Status |
|---|---|---|
| 0001–0013 | base + role + profile_extras (incl. `birthday`) | ✓ |
| 0015 | form_config | ✓ |
| 0016 | paf_submissions + paf_audit_log | ✓ |
| 0017 | re-seed form_config snake_case | ✓ |
| 0018 | PAF schema additions (pay_basis, transfer/demotion, bonus types, SDO cols, `from_role` not `current_role`) | ✓ |
| 0019 | re-seed form_config with B-2b shape | ✓ |
| 0020 | training_start_date + training_end_date columns | ✓ |
| 0021 | re-seed form_config: training dates instead of training_days | apply when ready |
| 0022 | manageable_users() — SDOs include DOs | ✓ |
| 0023 | profiles.show_birthday boolean default true | ✓ |

## Currently in flight

**My Stores + Birthdays sprint** (just finished coding in sandbox).

Files added/changed:
- `supabase/migrations/0023_profile_show_birthday.sql` ✓
- `netlify/functions/org.js` — new (`?action=my-tree`, `?action=birthdays`)
- `src/modules/my-stores/` — new module: `MyStoresPage`, `StoreDetail`, `MemberProfileDrawer`, `BirthdayWidget`, `BirthdayCelebration`, `api.ts`, `types.ts`, `dateRange.ts`
- `src/app/router.tsx` + `src/app/nav.ts` — register `/my-stores`
- `src/modules/account/AccountPage.tsx` — GM-only `show_birthday` toggle
- `src/modules/dashboard/DashboardPage.tsx` — wire BirthdayWidget + BirthdayCelebration
- `src/types/database.ts` — `Profile.show_birthday`
- `package.json` — adds `canvas-confetti` + `@types/canvas-confetti`

Patch: `/tmp/my-stores.patch` (77929 bytes, split into 4 base64 chunks of ~7 KB).

User has not yet applied + pushed at the time the session was paused. Migration 0023 IS applied to Soar Hub v2 (column verified present + PostgREST cache reloaded).

## Resend email integration

Wired in `netlify/functions/paf.js`. From: `paf@mysoarhub.com` (DKIM verified at `resend._domainkey.mysoarhub.com`). Env vars set in Netlify:
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL=paf@mysoarhub.com`
- `RESEND_FROM_NAME=SOAR PAF`

## Stop-hook noise

The user sees `Stop hook feedback: ...There are N unpushed commit(s)...` after almost every assistant turn. The script at `~/.claude/stop-hook-git-check.sh` is a no-op (`exit 0`). The message comes from somewhere we couldn't trace. **Ignore it** — it's spam, not a real signal. The actual git state is shown by `git status` + `git log --oneline`.

## Other useful context

- Auto-PR automation is NOT in place — user manually opens + merges PRs through the GitHub UI.
- Existing TeamPage uses **email-copy buttons + tel: phone links**. New `MemberProfileDrawer` follows the same pattern.
- PAF history on the member profile drawer is gated to viewers with role >= DO (do, sdo, rvp, vp, coo, admin, payroll). Two tabs: "Submitted" (exact match on submitter_id/email) and "Mentioned as employee" (fuzzy `ilike` on employee_name).
- Confetti library: `canvas-confetti` (already in package.json).
- Birthday widget grouping: by RVP, sorted by date asc then name. Uses `thisAndNextWeekRange()` from `dateRange.ts` (Mon of this week → Sun of next).

## Pending decisions / open threads

- **Adding more data points per store** — user asked about extending the `stores` table. Three options offered (A: add columns + extend BulkOrgImport, B: jsonb metadata bag, C: ad-hoc SQL bulk update). Awaiting user's choice on which fields to add.
- **PR #37** for the My Stores sprint — patch in user's queue, not yet applied/pushed.

### Parked ideas (not pursuing now, revisit on user prompt)

- **Progressive Web App (PWA) for Work Orders V2, My Team, Chat.** Scoped at three tiers:
  - **Tier A — Installable + offline reads** (~5 days). Manifest, icons, service worker via `vite-plugin-pwa` + Workbox, TanStack Query persistence to IndexedDB, offline UI primitives (banner, stale chip), install prompt component (Chrome/Edge + iOS "Add to Home Screen" instructions), Supabase auth durability check. WO2 / My Team / Chat all get cached reads.
  - **Tier B — Mobile-optimized layouts** (~3-4 days on top). Bottom nav for WO2 tabs on narrow screens, swipe-actions on ticket rows (mark on-site / complete), pull-to-refresh, FAB for new ticket, single-column thumb-scrolled team cards, full-height chat with keyboard handling, optimistic send.
  - **Tier C — Offline writes + push notifications** (~5-7 days). IndexedDB write queue with retry + conflict resolution, VAPID push subscriptions wired to drive-by/quote-approved alerts. Deferred until usage data justifies.
  - Recommendation when we revisit: ship Tier A standalone, pilot with 2-3 GMs + 2 DOs, then prioritize Tier B based on their feedback. Skip Tier C until someone reports a real offline-write loss.
  - Open questions to answer first: app name on home screen, icon source (vector SOAR logo), splash theme color, which WO2 admin tabs to hide on mobile.

- **Approver Portal for COO / VP / RVPs (token-in-URL, same pattern as vendor QR).** ~2 days. One PR.
  - Migration 0048: `approver_tokens(user_id, token, label, is_active, expires_at, last_used_at, revoked_at, revoked_by_id)`. Token bound to a specific profile server-side.
  - `netlify/functions/approver-portal.js`: `resolve` (token → profile), `listPending` (filtered to caller's approval tier), `decide` (delegates to existing `decideApproval` code path; logs IP + UA in audit).
  - Public route `/a/:token` — mobile-first approval queue, big approve/reject buttons, in-app confirm sheet (anti-suppress pattern from vendor portal).
  - Admin UI: extend Vendor QR pattern — mint per-user, copy URL or display QR for AirDrop / Signal handoff, revoke.
  - "Stays logged in" behavior: indefinite until admin revokes or `expires_at` passes (default 365d). No client-side identity; the URL IS the credential. Survives phone replacement (just save the URL on the new device).
  - Open questions to answer first:
    1. Tier rule — strict to caller's tier, or allow escalation override into lower tiers?
    2. Notes on every approval, or one-tap "approve, no notes" for the common case?
    3. Optional WebAuthn / biometric for high-dollar approvals (>$5k) — adds ~1 day, probably skip in v1.
    4. Token transmission channel — recommend AirDrop / Signal / 1Password share, not plain email.

## Working directly with the user

- They run `pbpaste > /tmp/x` to capture clipboard.
- They paste base64 chunks from the chat into terminal.
- Print **readable diff first**, then base64 chunk(s) for any patch.
- When in doubt about clipboard fragility, fall back to a Python heredoc script.
