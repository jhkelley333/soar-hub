# Ranking (Ranker)

## What it is

The Ranker scores every active store on a set of KPIs each week (PTD = period-to-date, WTD = week-to-date) and ranks them. It runs Monday after the week closes, pulling from the Skunkworks KPI snapshot. Scores are stored in `ranking_rows` with the run tracked in `ranking_runs`.

## How to reach it

- Sidebar → **Ranker** (`/admin/ranking`)
- Each week shows as a card; click to open the full table.
- Ask Tot can also answer ranking questions directly.

## Run status

- `ranking_runs.status = 'complete'` = fully ranked.
- Multiple runs for one week may exist (e.g. if Refresh was clicked). Always use the one with the **latest `started_at`** at `status='complete'`.
- **Run now** (at the top of the Ranker page) only re-ranks the latest week.
- **Refresh** (on a past week) re-applies current credits to that week's snapshot. Use this after adding/withdrawing a credit that should affect a past week.

## Tiers

| Tier | What it represents |
|---|---|
| `store` | Individual store (entity_key = store number) |
| `do` | DO rollup (entity_key = DO name) |
| `sdo` | SDO rollup |
| `rvp` | RVP rollup |
| `company` | Org-wide summary |

## Scope

- `ptd` = period-to-date (accumulates from start of period)
- `wtd` = week-to-date (the single week only)

## Key metrics in `ranking_rows.metrics`

- `pctVsLy` — net sales % vs last year (decimal; multiply × 100 for display)
- `laborPct` — labor % of sales (decimal)
- `chart` — chart labor % (decimal)
- `varianceToChart` — laborPct − chart (decimal)
- `hoursOver` — hours over guide
- `onTimePct` — on-time delivery % (decimal)
- `vog` — voice of guest score
- `cashOverShort` — cash over/(short) amount
- `gm` — GM name
- `doName` — DO name
- `sdoName` — SDO name
- `rvpName` — RVP name
- `location` — store location label

## Complaints / CP10K

- **CP10K is NOT in the Hub.** It lives in Inspire's Power BI "Customer Care – CP10K Trend" report and lags at least a week.
- The Skunkworks feed has a survey-based `complaints` count — it's a **different measure** (3–7× lower than CP10K, not consistent store to store). Never present it as CP10K.
- The Ranker holds complaints at a neutral placeholder (`callsPer10k = 1.8`, score 3).

## Legacy Ranker

- The old sheet-fed Ranker (`/ranker`) is archived off the sidebar. Its route stays alive for old deep links.
- Ranker History Backfill (System Settings → Data & Imports) migrated v1 sheet + v2 database weeks into one table for cross-week analysis.
