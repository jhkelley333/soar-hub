# SOAR Hub Navigation

Generated from src/app/nav.ts.

## Sidebar routes by section

### Main
- `/` — **Dashboard** — landing page with KPI snapshot; all store/ops roles
- `/obsession` — **Obsession Metric** — company-wide single metric; all roles
- `/admin/work-orders-v2` — **Work Orders** — facilities ticketing (V2); all roles
- `/chat` — **Chat** — internal messaging; all roles
- `/comms-board` — **Comms Board** — weekly store communication board; all roles

### Operations
- `/operations` — **Operations Tools** — card hub for field tools (Site Audits, Walkthroughs, Reno Scoping, Weather); GM and above
- `/business-disruptions` — **Business Disruptions** — report a closure or disruption; GM and above
- `/admin/ranking` — **Ranker** — weekly performance ranking; GM and above. Ask Tot lives here too (at `/admin/ask-tot`)
- `/labor-v2` — **Labor** — daily labor % vs chart, fed by KPI feed; all roles (store-scoped)
- `/rvp-commitments` — **RVP Commitments** — commitments tracker; RVP and above
- `/period-commitments` — **Period Commitments** — period-level commitments; RVP and above
- `/admin/cash-management` — **Cash Management** — night-close and deposit cycle; GM and above
- `/pl` — **P&L** — store income statements by period; GM and above
- `/count` — **Daily Count** — inventory count scores; GM and above
- `/admin/close-time-watch` — **Close-Time Watch** — stores whose last clock-out was before scheduled close; SDO/RVP (VP+ via System Settings)
- `/admin/google-reviews` — **Google Reviews** — ratings and reviews (stale since 10/20/2026); SDO/RVP (VP+ via System Settings)
- `/admin/hours-of-operation` — **Hours of Operation** — standard + special hours; SDO/RVP (VP+ via System Settings)

### People
- `/paf` — **PAF** — Payroll Adjustment Forms queue; DO, Payroll, Admin
- `/paf/archive` — **PAF Archive** — full searchable record + CSV export; Payroll, Admin
- `/employee-actions` — **Employee Actions** — Training Credit and PTO forms + approvals; GM and above
- `/coaching` — **Coaching Tool Kit** — coaching-for-performance reference cards; Shift Manager and above
- `/team-pipeline` — **Team Pipeline** — talent planning; GM and above
- `/contacts` — **Contacts** — people directory; all roles
- `/team` — **Users** — Hub user accounts; GM and above
- `/admin/gm-roster` — **Roster** — GM roster + leadership + birthdays; DO, SDO, RVP (VP+ via System Settings)

### Workspace
- `/resources` — **Resources** — Google Drive-backed document library (operations guides, SOPs); GM and above
- `/my-stores` — **My Stores** — store cards with team info; GM and above
- `/schedule` — **Calendar** — events and schedule; GM and above
- `/account` — **Account** — personal profile, birthday toggle; all roles
- `/myhub` — **Support Ticket** — submit a Hub support request; all roles

### Admin / System Settings (`/admin/system-settings` — VP, COO, Admin)
- **Org Tools**: Org Admin, GM Roster, Store Geofences, Hours of Operation, Close-Time Watch, Google Reviews, Territory Map, Org Alignment
- **Intelligence Trait & Learning**: Intelligence Trait (`/culture-index`), Team Playbook (`/culture-index/playbook`), Trait Analytics (`/culture-index/overview`), Soar MyLearning
- **Accessibility**: User Activity, Role Access, Region Access, Feature Flags, Reports, Metric Definitions, Command Center Links, Stay-Logged-In Links
- **Beta Test**: Ask Tot (`/admin/ask-tot`), KPI Dashboard, Metrics Board, Store Visit, Bottom Performers, Cancun Convention
- **Data & Imports**: Data Health, Labor Rollup, Pull Log, Bulk Attributes, Bulk User Import, Bulk Org Import, Cultural Index Import, Ranker History Backfill, Acquisitions
- **Templates & Config**: PAF Config, Labor Settings, Assessment Templates, Walkthrough Templates, Manuals Admin

## Role access summary

| Role | Key modules |
|---|---|
| GM | Dashboard, Work Orders, Labor, Employee Actions, Resources, My Stores |
| DO | All GM + PAF queue, Roster |
| SDO | All DO + Hours of Operation, Close-Time Watch, Google Reviews |
| RVP | All SDO + RVP Commitments, Period Commitments, Ask Tot |
| VP | All + System Settings (no sidebar clutter) |
| COO | Same as VP |
| Admin | Everything |
| Payroll | PAF queue only + PAF Archive, PAF Config, Data Health |
