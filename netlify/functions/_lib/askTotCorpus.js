// Ask Tot help corpus — inlined so it's always available in the Netlify bundle.
// Content mirrors docs/ask-tot/*.md. Update both when rules change.
//
// hubHelpSearch(query) → string | null

const CORPUS = [
  {
    file: "navigation.md",
    title: "SOAR Hub Navigation",
    content: `
## Sidebar routes

### Main
- Dashboard (/) — landing KPI snapshot; all roles
- Obsession Metric (/obsession) — company-wide single metric; all roles
- Work Orders (/admin/work-orders-v2) — facilities ticketing; all roles
- Chat (/chat) — internal messaging; all roles

### Operations
- Operations Tools (/operations) — card hub: Site Audits, Walkthroughs, Reno Scoping, Weather; GM+
- Business Disruptions (/business-disruptions) — report closure/disruption; GM+
- Ranker (/admin/ranking) — weekly performance ranking; GM+. Ask Tot is at /admin/ask-tot
- Labor (/labor-v2) — daily labor % vs chart; all roles (store-scoped)
- RVP Commitments (/rvp-commitments) — RVP and above
- Period Commitments (/period-commitments) — RVP and above
- Cash Management (/admin/cash-management) — night-close + deposit cycle; GM+
- P&L (/pl) — store income statements by period; GM+
- Daily Count (/count) — inventory count scores; GM+
- Close-Time Watch (/admin/close-time-watch) — stores whose last clock-out was before scheduled close; SDO/RVP (VP+ via System Settings)
- Google Reviews (/admin/google-reviews) — ratings + reviews (stale since 10/20/2026); SDO/RVP (VP+ via System Settings)
- Hours of Operation (/admin/hours-of-operation) — standard + special hours; SDO/RVP (VP+ via System Settings)

### People
- PAF (/paf) — Payroll Adjustment Forms queue; DO, Payroll, Admin
- PAF Archive (/paf/archive) — full record + CSV export; Payroll, Admin
- Employee Actions (/employee-actions) — Training Credit and PTO forms + approvals; GM+
- Coaching Tool Kit (/coaching) — coaching reference cards; Shift Manager+
- Team Pipeline (/team-pipeline) — talent planning; GM+
- Contacts (/contacts) — people directory; all roles
- Users (/team) — Hub user accounts; GM+
- Roster (/admin/gm-roster) — GM roster + leadership + birthdays; DO, SDO, RVP (VP+ via System Settings)

### Workspace
- Resources (/resources) — Google Drive document library (ops guides, SOPs); GM+
- My Stores (/my-stores) — store cards with team info; GM+
- Calendar (/schedule) — events; GM+
- Account (/account) — personal profile, birthday toggle; all roles
- Support Ticket (/myhub) — submit Hub support request; all roles

### System Settings (/admin/system-settings — VP, COO, Admin)
Org Tools: Org Admin, GM Roster, Store Geofences, Hours of Operation, Close-Time Watch, Google Reviews, Territory Map, Org Alignment
Intelligence Trait: Culture Index trait framework (/culture-index), Team Playbook (/culture-index/playbook), Trait Analytics (/culture-index/overview), Soar MyLearning (/qsr)
Accessibility: User Activity, Role Access, Region Access, Feature Flags, Reports, Metric Definitions, Command Center Links, Stay-Logged-In Links
Beta Test: Ask Tot (/admin/ask-tot), KPI Dashboard, Metrics Board, Store Visit, Bottom Performers, Cancun Convention
Data & Imports: Data Health, Labor Rollup, Pull Log, Bulk Attributes, Bulk/Org Imports, Ranker History Backfill, Acquisitions
Templates & Config: PAF Config, Labor Settings, Assessment Templates, Walkthrough Templates, Manuals Admin
`,
  },
  {
    file: "labor.md",
    title: "Labor Rules and Credits",
    content: `
## Calendar
Fiscal weeks run Mon–Sun. Periods use 4-4-5. P11 W1 = Mon 10/26–Sun 11/1/2026.

## Source of truth
The Ranker is the source of truth for labor. It uses the Skunkworks Sunday WTD row with all labor credits applied, run Monday after the week closes.
The daily feed (labor_v2_daily) is captured once a day and isn't re-pulled. Late timecard edits only show in Sunday's WTD.
Chart % = Sunday wtd_target_labor_pct.
If several Ranker runs exist for one week, use the latest started_at with status='complete'.
A Ranker run is a snapshot. Credit changes after the run don't show until an admin clicks Refresh on that week (Admin → Ranking → pick week → Refresh). Run now ranks the latest week only.

## Where to view labor
- Labor (/labor-v2) — daily labor % by store. GM sees their store; DO+ sees their scope.
- Ranker (/admin/ranking) → pick a week → store rows show labor % and variance to chart.
- Labor → By Store → WTD — the same WTD row the Ranker uses.

## Credit types
| Type | Amount | When it applies |
|---|---|---|
| Training request | per-day $ on request | Approved and not Withdrawn |
| GM PTO | $176/day | GM position only, approved and not Withdrawn |
| No-GM | $880/wk = $125.71/day | Every day between start and end (open = through today) |
| GM support | weekly hrs × blended wage | Every day between start and end |
| Corporate class | $176/day × attendee count | Listed dates |

Every $ credit also reduces hours (÷ blended wage over last ~35 days).

## Stacked credits (flag these)
Stacked = No-GM credit running alongside GM PTO or GM support at the same store on the same days. That's double-credit for one GM gap.

To fix: Employee Actions → History → open the request → Withdraw (reason) → check Labor → By Store → WTD for that week.

## Closing doesn't stop a credit
Only Withdrawn (DO+ on non-terminal requests) or Delete (admin only) stops it.
`,
  },
  {
    file: "employee-actions.md",
    title: "Employee Actions — Training Credits and PTO",
    content: `
## Where to find it
Sidebar → Employee Actions (/employee-actions)
Tabs: Training Credit requests, PTO requests, Approvals (DO+ approval queue), History, Credit Bank, PTO Report, Close-out (admin).

## Training Credit Bank
Each store gets $2,000/year by default. Requests over the bank route to RVP approval (over_bank=true). Rejected and Withdrawn requests return money to the bank.
To check: Employee Actions → Credit Bank → select store.

## Training Credit request flow
GM submits → auto-approved or routes to RVP if over_bank.
Status: submitted → approved → closed (admin close-out) or rejected / withdrawn.
Credit is active from approved_at through last_day_date.
To withdraw: History → open request → Withdraw (reason). DO+ can withdraw approved non-terminal requests. Admin can delete any.

## PTO flow
Submitted → DO Approved → SDO/RVP Approved (credit starts here) → Closed (close-out).
Short-notice GM request (<30 days) skips the DO step.
When an SDO or RVP enters PTO themselves, it's approved on submit and credits immediately. That's how duplicates create instant double credits.
Closing does NOT stop the credit. Only Withdrawn or Delete stops it.
A DO+ cannot withdraw a Closed request — only admin can delete it.

## Allowance
GM: 5 days/calendar quarter. Hourly: 40 hrs. Short notice = submitted <30 days before start.

## How to withdraw a PTO request
Employee Actions → History → filter All → find request → Withdraw (enter reason) → confirm → check Labor → By Store → WTD for that week.

## Credit amounts
GM PTO: $176/day (ea_settings.gm_pto_daily_credit). GM position only.
No-GM: $880/week = $125.71/day. Runs every day between start and end date (open = through today).
`,
  },
  {
    file: "ranking.md",
    title: "Ranking (Ranker)",
    content: `
## What it is
The Ranker scores every active store on a set of KPIs each week (PTD=period-to-date, WTD=week-to-date) and ranks them. Runs Monday after the week closes.

## Where to find it
Sidebar → Ranker (/admin/ranking). Each week shows as a card; click to open the full table.

## Run status and Refresh
Multiple runs for one week may exist. Always use the latest started_at with status='complete'.
Run now (top of Ranker page) only re-ranks the latest week.
Refresh (on a past week) re-applies current credits to that week's snapshot. Use after adding/withdrawing a credit that should affect a past week.

## Tiers
store: individual store (entity_key = store number)
do: DO rollup (entity_key = DO name)
sdo: SDO rollup
rvp: RVP rollup
company: org-wide summary

## Scope
ptd = period-to-date (accumulates from start of period)
wtd = week-to-date (the single week only)

## Key metrics
pctVsLy: net sales % vs last year (decimal; × 100 for %)
laborPct: labor % of sales
chart: chart labor %
varianceToChart: laborPct − chart
hoursOver: hours over guide
onTimePct: on-time delivery %
vog: voice of guest
cashOverShort: cash over/(short)
gm, doName, sdoName, rvpName: leader names

## Complaints / CP10K
CP10K is NOT in the Hub. It's in Inspire's Power BI. The Skunkworks survey complaints count is a different measure (3–7× lower) — never present it as CP10K. The Ranker uses a placeholder (1.8, score 3).
`,
  },
  {
    file: "roster.md",
    title: "Roster — GM and Leadership",
    content: `
## Where to find it
- Roster (/admin/gm-roster) — DO, SDO, RVP (sidebar)
- System Settings → Org Tools → GM Roster — VP, COO, Admin

## GM Roster
Named: a GM is assigned (gm_name, hire_date, placement_date)
Open: no GM (projected_gm_name, projected_fill_date, still_interviewing)

## No-GM Tags
Applies a $880/week labor credit while the store has no GM.
Create: Employee Actions → No-GM tag → store, reason, start date, optional end date, note.
End: Go to the No-GM tag entry → set an end date. If end is blank, the tag is open-ended through today.
To end a No-GM tag: Employee Actions → History → filter No-GM tags for the store → open the entry → set end date.

## Known issue: Roster vs. SDO Update Sheet
The GM Roster (Hub) and the SDO 2026 Update Sheet disagree on dozens of stores. The SDO column on the sheet holds market labels, not person names. DO names may still show on the sheet even after Hub is updated.

## My Stores
Sidebar → My Stores (/my-stores) — store cards with team info, birthday widget; GM+.
`,
  },
  {
    file: "data-gaps.md",
    title: "Known Data Gaps",
    content: `
## Google Reviews
No reviews captured since October 20, 2026. The sync is broken. Ratings shown in Hub are stale.

## Daily KPI rows
Daily feed (labor_v2_daily) is captured once a day and isn't re-pulled. Late timecard edits don't update daily rows — only the Sunday WTD.
Known gaps: store 4100 on 10/29/2026, store 4871 (Ankeny) intermittent.
The Ranker WTD is correct.

## CP10K / Complaints
CP10K is not in the Hub. Lives in Inspire's Power BI. The Skunkworks survey complaints count (rapSecondary.period.complaints) is 3–7× lower than CP10K and not consistent — never present as CP10K. Ranker uses placeholder (1.8, score 3).

## Roster vs. SDO Update Sheet
Disagree on dozens of stores. SDO column holds market labels, not names.

## Ranker credits after a run
Credit changes after a run don't show until admin clicks Refresh on that week.

## Promo / LTO
Promo and LTO data is not yet in the Hub.
`,
  },
  {
    file: "paf.md",
    title: "PAF — Payroll Adjustment Form",
    rvpOnly: true,
    content: `
## Where to find it
PAF queue: /paf (DO, Payroll, Admin). PAF Archive: /paf/archive (Payroll, Admin). RVP+ can ask Tot about PAF status.

## Who can submit
GM+. SDO/RVP required for Pay Adjustment (Salary) and New Hire (Salary Leader).

## Form categories
Backpay, Overtime, Cross Store Work, Bonus, New Hire, New Hire (Salary Leader), Pay Adjustment (Salary), Paid Sick, Training, PTO.

## Status flow
Pending → Needs Approval → Approved → Processed.
Pending → Rejected.
Pending SDO Approval → SDO/RVP sign-off.
Pending VP Approval → VP/COO sign-off.
Short-notice GM requests skip the DO step.

## Key rules
Processed does NOT stop a labor credit. Only Withdrawn or Deleted (admin) stops it.
Ask Tot is read-only — it shows counts/status but cannot approve, reject, or process.
Drive-in = the store being charged.
last4_ssn is never shown by Ask Tot.

## Stacked credit risk
GM PTO credit + No-GM credit running at the same store on the same days = double-credit for one GM gap. Check Employee Actions → History for the store.
`,
  },
];

/**
 * Search the help corpus for content relevant to `query`.
 * RVP-only docs are tagged; callers may filter them.
 * Returns a string with up to 3 matching sections, or null if nothing found.
 */
export function hubHelpSearch(query, { includeRvpOnly = false } = {}) {
  if (!query) return null;
  const terms = query.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  if (!terms.length) return null;

  const hits = [];
  for (const doc of CORPUS) {
    if (doc.rvpOnly && !includeRvpOnly) continue;
    const text = `${doc.title}\n${doc.content}`.toLowerCase();
    const score = terms.reduce((n, t) => n + (text.split(t).length - 1), 0);
    if (score > 0) hits.push({ doc, score });
  }
  hits.sort((a, b) => b.score - a.score);

  if (!hits.length) return null;
  return hits
    .slice(0, 2)
    .map((h) => `### ${h.doc.title}\n${h.doc.content.trim().slice(0, 1200)}`)
    .join("\n\n---\n\n");
}
