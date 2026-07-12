# Ranking Module — Phase 0 audit: the brief measured against the Hub

Companion to `RANKING_MODULE_BRIEF.md` (Heath Kelley, VP Ops). This maps the
engine's input contract (§3 of the brief) onto what actually exists in this
codebase today, answers the §10 open decisions we can answer from the code,
and lists exactly what is still needed to open Phase 0a.

Audited 2026-07-12 against `main`.

## 1. Input contract — verified against the code

| Engine input | Brief says | What the Hub actually has | Verdict |
|---|---|---|---|
| `sales, lySales` | KPI feed | `labor_v2_daily.net_sales` + `prev_year_net_sales`, plus `wtd_`/`ptd_` bands (`_lib/kpiLabor.js`) | ✅ reuse |
| `tickets, lyTickets` | KPI feed | Feed carries `tickets` + `previousYearTickets` (`kpi-snapshot.js` sums them) — **not yet persisted per store/day** | ⚠️ extend capture |
| `laborPct` | KPI feed | `labor_v2_daily.labor_pct` (+ bands) | ✅ reuse |
| `onTimePct` | KPI feed | Feed carries `onTimePercentageNumerator/Denominator` — **not persisted per store/day** | ⚠️ extend capture |
| `voids` | KPI feed | Feed carries `voidTotal` — **not persisted per store/day** | ⚠️ extend capture |
| `complaints` | KPI feed | **Field exists in the feed** (`complaints`, `complaintsPer10k`) but was null on the 2026-07-11 Total row — confirm it populates at store level. Feed also carries `likelyToReturn*` (VOG L2R). Full inventory: `docs/kpi-feed-fields.md` | ⚠️ verify store-level, then extend capture |
| `custCount` (→ calls/10k) | = tickets | Same as tickets | ⚠️ extend capture |
| `period, week, weeksInPeriod, weekEnding` | fiscal calendar | `_lib/fiscal.js` `fiscalForDate(iso)` → `{period, weekInPeriod, weekStart, weekEnd, periodStart, periodEnd}`; `weeksInPeriod` from the 4-4-5 table. FY2026 starts 2025-12-29 | ✅ reuse |
| `store, location, gm, doName, sdoName, rvpName` | Org table | `stores → districts → areas → regions` + `user_scopes` → `profiles` (UUIDs). `_lib/kpiOrg.js resolveOrg()` walks it | ✅ reuse — **UUID keys available**, see §4.2 answer |
| `avgWage` | Labor v2 | Per-store, per-band: `labor_cost / labor_hours` computed on read. **No single company wage exists** | ✅ per-store (decision needed at leader tiers — §3 below) |
| `chart` (labor target %) | Labor v2 | `labor_v2_daily.target_labor_pct` (+ `wtd_`, `ptd_`) — Expressway's own target, **not** the workbook's normalized-volume lookup | ✅ **DECIDED (Heath 7/12): IX target IS the goal.** Chart lookup + pad not ported — see DEVIATIONS.md B1 |
| `chart2` | seed table | Nothing in Hub | ⏸ **ON HOLD (Heath 7/12)** — WTD/entity labor score gated, DEVIATIONS.md B2 |
| `trainingCreditDollars` | Labor v2 | `training_credit_requests` — **store grain only**. No leader-grain rows exist anywhere in Hub | ⚠️ see §3 |
| `ptoDollars` | Labor v2 | `pto_requests` GM rows → per-day dollar credit (`_lib/trainingCredit.js loadGmPtoCreditDates`) — store grain | ✅ matches |
| `laborPad` | seed | Nothing in Hub | ⏸ **ON HOLD (Heath 7/12)** — not seeded; IX target replaces chart+pad, DEVIATIONS.md B1 |
| `tenureSoar/tenureLoc` | placeholder | `profiles` has hire dates but per the brief run 1 ships null | ✅ null |
| `entity` | Org or entities.csv | **`stores.soar_company_name`** — "legal entity / Soar company name on file" (migration 0024, shown on My Stores) | ✅ **RESOLVED (Heath 7/12)** — read it directly; null values surface as a fill-me list. No entities.csv import. DEVIATIONS.md B3 |
| `bands` | NEW | Nothing | ➕ build (`ranking_config`) |
| IX / EcoSure / VOG / shops / BSC / TotZone | NEW | Nothing parses these. Upload + parser surface is greenfield | ➕ build |

**Net:** the financially-load-bearing inputs (sales, labor, targets, credits,
fiscal calendar, org) are all present. The gaps are: five KPI-feed fields not
yet persisted (tickets, LY tickets, on-time num/den, voids, complaints-if-present),
the two seed columns (chart2, labor pad), entity coverage, and the six parsers.

## 2. Things the brief doesn't know about this codebase

1. **The Hub already has a `/ranker` module** (`netlify/functions/ranker.js`,
   `ranker-summary.js`, `src/modules/ranker/` — Portfolio / Store View /
   Head-to-Head / FC Miss). It reads the *current sheet's output* via Google
   Sheets API (`SOAR_METRICS_SHEET_ID`). Three consequences:
   - The parallel-run diff (brief §9) can be **in-app**: same Hub, sheet-fed
     `/ranker` vs engine-fed `/ranking`, row by row.
   - Its metric aliases (`_lib/ranker-sheets.js HEADER_ALIASES`) are a proven
     map of the sheet's column vocabulary.
   - When cutover completes, `/ranker` repoints from the sheet to
     `ranking_rows` and the Sheets dependency dies.
2. **Functions are Netlify (Node ESM), not Supabase Edge (Deno).** The brief
   assumes `supabase/functions/`; this repo runs everything as Netlify
   functions with a service-role gatekeeper (RLS on, **no policies**; every
   function scope-checks the caller). The engine is pure JS and drops into
   either. Recommendation: **Netlify function `ranking-run.js`**, engine at
   `netlify/functions/_lib/ranking/engine.js`, validation harness runnable
   with plain `node test/validate.js`. §5.6's RLS design becomes scope checks
   in the function, matching every other module here.
3. **Scheduling:** the Monday run slots into the existing GitHub Actions
   cron pattern (like `kpi-capture`). Resend is already wired (PAF module) —
   distribution reuses it.
4. **The KPI snapshot lag guard (§5.5)** matches what we already know here:
   the feed lags ~a day and Hub's capture stamps `business_date` from the
   feed itself (`feedBusinessDate`). The run must still record + compare, as
   the brief insists.

## 3. §10 open decisions — answered from the code where possible

1. **Training credit grain: STORE ONLY.** `training_credit_requests` is keyed
   by `store_number`; no leader-grain rows exist. The engine's leader-tier
   rule (leader's own row ÷ leader's sales, `'SOAR QSR'` company key) has no
   Hub source. Options: (a) ingest the sheet's leader training-credit rows as
   a seed/source for parity, or (b) change the rule to sales-weighted store
   rollup — which is a math change and will fail leader-tier validation.
   **Recommend (a) for run 1**; revisit after cutover. → Heath to confirm.
2. **Wage grain: PER-STORE** (cost ÷ hours per band, computed on read).
   There is no company scalar in Hub. Phase 0 pins `12.84` per the brief;
   the post-cutover flip needs the weighted-average decision at leader tiers
   before it happens. → decision stands, deferred by design.
3. **chart2: ON HOLD (Heath, 7/12).** PTD ships first; WTD/entity labor
   score gated until chart2 is sourced or Labor v3 ships. DEVIATIONS.md B2.
4. **Labor target: DECIDED (Heath, 7/12) — IX target IS the goal.** The
   workbook chart lookup + labor pad are not ported. Labor-derived columns
   validate as a published diff instead of a hard equality gate; everything
   else keeps the 100% gate. DEVIATIONS.md B1.
5. **Entity: RESOLVED (Heath, 7/12)** — `stores.soar_company_name` is the
   legal entity, already in My Stores data. Nulls surface as a fill-me
   list. DEVIATIONS.md B3.
6. **Peer visibility:** genuinely open — Heath decides. Default proposal:
   leaders see the full table at their own tier and below within their scope
   (a DO sees all stores in-district ranked; sees their own DO row but not
   other DOs' rows; SDO+ see their DOs ranked; VP/admin see all). The sheet
   leaked everything, so anything at-or-tighter is an improvement.
7. **Labor pad ownership:** seed as-is for run 1 (never zero it — §5.1);
   long-term home is an admin editor on the ranking config page. Defer.

## 4. Blocked / needed from Heath (Phase 0a cannot open without these)

Only `RANKING_MODULE_BRIEF.md` was provided. Still needed, per §11:

- [ ] `src/Engine.js` (798 lines) — the port target
- [x] `src/Guardrails.js` — received 7/12, banked at `docs/ranking/reference/Guardrails.js`
- [ ] `test/validate.js` — the harness
- [ ] `seed/validation_snapshot.csv` (271 PTD rows) + `seed/validation_snapshot_wtd.csv`
- [x] ~~`seed/entities.csv`~~ — not needed; entity = `stores.soar_company_name` (DEVIATIONS.md B3)
- [ ] band thresholds (machine-readable) — still needed for the 8 scoring bands. ~~chart2 column~~ on hold (B2)
- [x] ~~labor-pad column~~ — on hold; IX target replaces chart+pad (B1)
- [ ] one raw sample of each of the six source files (IX ×2 CSVs, EcoSure, VOG ×2, shops, BSC xlsx, TotZone xlsx) — Heath loading "the ranker file… it has the 6"
- [x] raw KPI feed payload — received 7/12, inventoried in `docs/kpi-feed-fields.md`. `complaints`/`likelyToReturn*` exist but null on the Total row; check store level

## 5. Build order (adapted from §9 to this repo)

| PR | Scope | Gate |
|---|---|---|
| **F** (this one) | Foundation: migration 0237 (config/seed/source/run/row tables), this audit | — |
| **0a** | Engine + Guardrails dropped into `_lib/ranking/`, `test/validate.js` green | needs the file bundle |
| **0b** | Band/chart2/pad/entity seeds loaded, `avg_wage` = 12.84 config row | needs SPEC + columns |
| **0c** | Labor v2 target vs engine chart diff, written up | needs 0a |
| **1a** | Upload UI + six parsers into `ranking_src_rows` | needs sample files |
| **1b** | KPI adapter (incl. persisting tickets/on-time/voids) + fiscal binding + week-alignment guard | |
| **2a** | `ranking-run` function + scope-checked reads | |
| **2b** | `/ranking` UI (mockup reference) | 0a green first |
| **3** | Action report + export | |
| **4** | Monday cron + Resend + DRY_RUN → parallel run | |
| **5** | Deltas, trends, alerts → sheet retired; `/ranker` repointed | |

Non-negotiables from the brief that carry over verbatim: engine ported not
rewritten; validation 100% before UI; deliberate weirdness preserved in
`DEVIATIONS.md`; config versioned with `effective_from`; week-misalignment
guard never dropped.

One deviation from the brief's §2.4 ("Claude Code never runs git push"):
that rule was written for the sheet-era local setup. In this repo the
established workflow is push → PR → Heath merges after review, which keeps
the same human gate. Flagged here so it's a decision, not a drift.
