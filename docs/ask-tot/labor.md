# Labor — Rules and Credits

## Calendar

- SOAR fiscal weeks run **Mon–Sun**. Periods use 4-4-5. P11 W1 = Mon 10/26 – Sun 11/1/2026.
- Inspire's Customer Care calendar starts its year 12/29/2025, same period breaks.

## Source of truth

- **The Ranker is the source of truth for labor.** It uses the Skunkworks **Sunday WTD** row with all labor credits applied, and it's run (or refreshed) Monday after the week closes.
- The daily feed (`labor_v2_daily`) is captured once a day and **isn't re-pulled**. Late timecard edits only show up in Sunday's WTD, so summing daily rows can differ from the Ranker. When quoting labor, quote the Ranker.
- Chart % = Sunday `wtd_target_labor_pct`.
- If several Ranker runs exist for one week, use the **latest `started_at`** with `status = 'complete'`.
- **A Ranker run is a snapshot.** Credit changes made after the run don't show until an admin clicks **Refresh** on that week (Admin → Ranking → pick week → Refresh). **Run now** ranks the latest completed week only.

## Where to view labor

- **Labor** (`/labor-v2`) — daily labor %, by store. GM sees their store; DO+ sees their scope.
- **Ranker** (`/admin/ranking`) → pick a week → store rows show labor % and variance to chart.
- **Labor → By Store → WTD** — the same WTD row the Ranker uses, broken out by store.

## Credit types

| Type | Amount | When it applies |
|---|---|---|
| Training request | per-day $ on the request | Approved and not Withdrawn; weekday mapped to its first occurrence on/after `start_date` |
| GM PTO | $176/day (`ea_settings.gm_pto_daily_credit`) | **GM position only**, approved and not Withdrawn, per `vacation_days` date |
| No-GM | $880/wk = $125.71/day (`no_gm_weekly_credit`) | Every day between start and end (open-ended = through today) |
| GM support | weekly hrs × store blended wage, or buffer % of avg daily sales | Every day between start and end |
| Corporate class | $176/day × attendee count | Listed dates |

- Every $ credit also reduces hours (÷ the store's blended wage over the last ~35 days).

## Stacked credits (flag these)

**"Stacked"** = a No-GM credit running alongside GM PTO or GM support at the same store on the same days. That's double-credit for one GM gap and should be flagged.

How to identify: check `no_gm_credits` and `pto_requests` (position=gm, approved) and `gm_support_hours_credits` for the same store and overlapping dates.

To fix: go to **Employee Actions → History → filter All → open the request → Withdraw** (enter reason) → check **Labor → By Store → WTD** for that week to confirm the credit dropped.

## Known gaps

- The daily feed can be missing part of a day's sales (e.g. store 4100 on 10/29, store 4871 Ankeny). The Ranker WTD is correct.
- Closing a PTO request does not stop the credit. Only Withdrawn (DO+ on non-terminal requests) or Delete (admin only) stops it.
