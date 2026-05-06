# SOAR Hub — Claude Notes

## CRITICAL: Supabase project verification

**At the start of every session that involves Supabase / SQL / migrations, remind the user:**

> "Confirm you are connected to the **Soar Hub v2** project in Supabase before running any SQL. The account has multiple projects, including an older work-orders prototype with different tables."

The user has multiple Supabase projects under one account. Running DDL or SQL against the wrong project has already caused confusion (e.g. paste of `form_config` migration failing with `relation does not exist` because the wrong project was open).

How to verify:
- Open Supabase dashboard → top-left project switcher → must read **Soar Hub v2**.
- Spot-check by running `select to_regclass('public.form_config');` — should return `form_config` (not null) on the right project.

## Migration status (as of last session)

Confirmed applied: 0001–0013 (profiles has the expected SOAR Hub shape including `role`, `preferred_name`, `cfm_*`).

Confirmed NOT applied: 0015 (`form_config`), 0016 (`paf_submissions`).

Status unknown — verify before continuing: 0014 (`storage_buckets`), and whether `user_scopes`, `store_master`, audit tables from earlier migrations are present.

The repo has merged code (PR A admin config, PR B-1 PAF flow) that depends on 0015 + 0016. Until those migrations are applied, those features cannot work end-to-end.

## Pending work

- **PR B-2a:** Login hang fix — 8s timeout around `getSession()` in `AuthProvider`, defensive `sb-*` token cleanup on boot, cache headers in `netlify.toml`.
- **PR B-2b:** PAF form revisions (10 items) — login fix is prerequisite. Includes Hourly/Salary toggle, removing Final Check + Other categories, dedicated Demotion/Transfer sections, Bonus consolidation with Referral Tier auto-fill, SDO approval workflow.
- **Open question pending user answer:** one shared `pay_basis` field vs. separate per section (PTO + Illness).

## Branch convention

All development on `claude/resume-phase-2a-n81Nd` (per session instructions). Push only to that branch.
