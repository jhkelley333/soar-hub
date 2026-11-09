# Known Data Gaps

## Google Reviews

- **No reviews captured since October 20, 2026.** The sync is broken. Ratings shown in Hub are from before that date.
- Fix: Admin → System Settings → Back Up Syncs → Weather Sync (not yet wired for reviews). The Google Reviews page at `/admin/google-reviews` will show stale data until the sync is restored.

## Daily KPI rows

- The daily feed (`labor_v2_daily`) is captured once a day and **isn't re-pulled**. Late timecard edits don't update the daily rows — they only show up in the Sunday WTD.
- Known partial-day gaps: store 4100 on 10/29/2026, store 4871 (Ankeny) has had intermittent gaps.
- **The Ranker WTD is correct** because it uses the Sunday snapshot with all edits applied.

## CP10K / Complaints

- **CP10K is not in the Hub.** It lives in Inspire's Power BI "Customer Care – CP10K Trend" report and lags at least a week. The current period shows 0.00 until loaded.
- The Skunkworks feed has a survey-based `complaints` count (`kpi_snapshots.payload.rapSecondary.period`). It's 3–7× lower than CP10K and not consistent store to store. **Never present it as CP10K.**
- The Ranker holds complaints at a neutral placeholder (callsPer10k = 1.8, score 3).

## Roster vs. SDO Update Sheet

- The GM Roster in Hub and the SDO 2026 Update Sheet disagree on dozens of stores.
- The SDO column on the sheet holds market labels, not person names.
- DO names (e.g. Robert Finley, Sara Rice) may still show on the sheet even after Hub is updated.

## Ranker credits after a run

- A Ranker run is a snapshot. Credit changes made **after** the run don't show until an admin clicks **Refresh** on that week (Admin → Ranking → pick week → Refresh).
- **Run now** only re-ranks the latest completed week.

## Promo / LTO

- Promo and LTO data is not yet in the Hub. Tot cannot answer questions about current promotions.
