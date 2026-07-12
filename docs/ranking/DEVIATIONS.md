# Ranking Module — DEVIATIONS.md

Required by the brief (§2.3): anything that differs from the sheet's behavior
gets written down here, deliberately, before it ships. Two kinds of entries:
(A) the sheet's own deliberate weirdness we must PRESERVE, and (B) decisions
Heath has made to deviate from sheet parity in the Hub build.

## A. Sheet behavior to preserve (brief §4.5 — do NOT "fix")

- FC efficiency ≥ 1.01 → score 5 at ALL tiers (the workbook's DO tier gave 1).
- Blank labor pad → 0 (a VLOOKUP miss, not a neutral value).
- Missing IX data → store treated as 96.0% efficiency, still gets a score.
- `NO LY` sales → sales score 3. Missing band input defaults: BSC → 1,
  complaints → 3, ecosure → 3, vog → 3, total training → 3. On-time has NO
  default (deliberate).
- The entity tier does NOT add NO-LY stores' current sales into `lySales`;
  every other tier does.
- Dollar misses are absolute — a saving store never offsets a losing one.
- Total Training is scored 1–5 but does NOT count toward Total Points.
- `#N/A` and `No Audit` appear as literal strings in validation output.
  Reproduce them.

## B. Decided deviations from sheet parity (Heath, 2026-07-12)

### B1. Labor goal = IX/Expressway per-store target. Chart lookup + labor pad ON HOLD.

The workbook's `laborChartRow(volume, cfg.laborChart)` lookup and the
store-map `laborPad` column are NOT ported. The engine's `chart` input is
Labor v2's per-store `target_labor_pct` (daily/WTD/PTD bands from the feed).
`ranking_store_seed.labor_pad` stays in the schema but unseeded (0-cost to
revisit).

**Consequence for validation:** labor-derived columns (variance to chart,
labor $ miss, hours over, labor score, and therefore total points + rank)
will legitimately differ from the sheet wherever the sheet's chart+pad
differs from the IX target. The Phase 0 harness therefore validates in two
tiers:
1. **Exact match** — every non-labor-derived column, against both snapshots.
2. **Published diff** — labor-derived columns get a store-by-store diff
   report (sheet chart+pad vs IX target and the score deltas), reviewed by
   Heath, instead of a hard equality gate.

This supersedes the brief's "100% or do not proceed" for the labor columns
only; everything else keeps the hard gate.

### B2. chart2 ON HOLD → WTD/entity labor score gated.

`laborScoreChart(laborPct, chart1, chart2)` needs the second threshold that
only existed in the sheet's Config tab. Decision: hold. PTD ships first;
the WTD tab's labor score (and the entity-tier labor score) stays gated
until either chart2 is seeded or Labor v3 publishes a second threshold.

### B3. Entity = `stores.soar_company_name`. No entities.csv import.

The legal entity already lives on the stores table (My Stores data,
migration 0024). `ranking_store_seed.entity` stays unused; the adapter
reads `soar_company_name` directly. Stores with a null value surface on the
status board as a fill-me list rather than importing a stale CSV.

### B4. Leader keys are org UUIDs, not name strings (brief §4.2 — planned).

`do:<uuid>` / `sdo:<uuid>` / `rvp:<uuid>` from user_scopes; display names
resolve in the UI. Engine treats them as opaque strings.

### B7. Labor comes CREDIT-ADJUSTED from Labor v2 (Heath, 7/13).

The sheet feeds raw labor % and subtracts training-credit / PTO dollars
inside the engine (store Y/Z columns, leader-grain training credit rows).
The Hub inverts this: **Labor v2 is the labor truth** — its WTD/PTD labor
already has training credit, GM PTO, and No-GM (open store) credit applied
through the one shared pipeline (`loadLaborCredits` → `applyCreditsToRows`),
the same numbers every labor page shows.

The adapter therefore:
- feeds the engine the credit-ADJUSTED `laborPct` per band,
- zeroes `trainingCreditDollars` / `ptoDollars` (numeric 0, not null — the
  engine's variance needs numbers) and passes no `leaderTrainingCredit`,
- lets `varianceToChart = adjustedLaborPct − chart(IX target)`.

Consequences:
- **Open decision §10.1 (leader-grain training credit) is MOOT** — leader
  rollups inherit credits through the sales-weighted store numbers. The SDO
  sheet's Training Credit tab is NOT needed.
- The ranking's labor always equals Labor v2's labor — one pipeline, no
  drift between what a GM sees on /labor-v2 and what ranks them.
- The output's trainingCreditPct/ptoPct columns read 0; credit visibility
  in the ranking UI (if wanted) comes from Labor v2 data, not the engine.
- Falls under the B1 two-tier validation: labor-derived columns diff
  against the sheet rather than hard-match (the sheet's credit math and
  chart both differ by design).

### B6. Complaints data ON HOLD (Heath, 7/13).

No complaints source is wired for run 1. The engine's own fallback keeps
this neutral: a missing `callsPer10k` renders as `'-'` and
`complaintsScore` defaults to 3 for every store, so nobody gains or loses
rank from the hold. The `/admin/ranking` settings page carries the
placeholder; when a source lands (feed store-level field, or an export),
it plugs into the adapter without touching the engine.

### B5. Runtime is Netlify Functions (Node ESM), not Supabase Edge (Deno).

Matches every other module in this repo; the engine is pure JS and does not
care. RLS-with-policies (brief §5.6) becomes the Hub's standard service-role
gatekeeper: RLS on, no policies, scope checks in the function.
