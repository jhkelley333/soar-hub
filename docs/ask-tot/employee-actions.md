# Employee Actions — Training Credits and PTO

## Where to find it

- Sidebar → **Employee Actions** (`/employee-actions`)
- Tabs: Training Credit requests, PTO requests, Approvals (DO+ approval queue), History, Credit Bank, PTO Report, Close-out (admin).

## Training Credit Bank

- Each store gets **$2,000 per calendar year** by default (`training_credit_budgets` overrides; `training_credit_adjustments` for manual adds/removes).
- Requests over the bank amount route to RVP approval (`over_bank = true`). Rejected and Withdrawn requests return the money to the bank.
- To check a store's bank: Employee Actions → Credit Bank → select the store.

## Training Credit request flow

1. GM submits request (employee name, training type, dates, hourly wage, $ amount).
2. Auto-approved or routes to RVP approval when `over_bank`.
3. Status: `submitted` → `approved` → `closed` (after the training ends and admin closes out) or `rejected` / `withdrawn`.
4. Credit is active from `approved_at` through the last training day (`last_day_date`).
5. To withdraw: History → open request → **Withdraw** (enter reason). DO+ can withdraw approved non-terminal requests. Admin can delete any.

## PTO request flow

Submitted → DO Approved → **SDO/RVP Approved** (credit starts here) → Closed (close-out).

A short-notice GM request (< 30 days out) skips the DO step and goes straight to SDO/RVP.

**When an SDO or RVP enters PTO themselves, it's approved on submit and credits immediately.** That's how duplicate entries create instant double credits.

**Closing doesn't stop the credit.** Only:
- **Withdrawn** (DO+ on non-terminal requests) stops it.
- **Delete** (admin only, any status) stops it.

A DO+ **cannot withdraw a Closed request** — only an admin can delete it.

## PTO allowance

- GM: 5 days per calendar quarter (`PTO_QUOTA_GM_DAYS`).
- Hourly: 40 hours.
- Short notice: submitted fewer than 30 days before the start date.

## Credit amounts

- **GM PTO**: $176/day (`ea_settings.gm_pto_daily_credit`). GM position only.
- **No-GM credit**: $880/week = $125.71/day. Runs every day between start and end date (open-ended = through today).

## How to withdraw a PTO request

Employee Actions → History → filter **All** → find the request → **Withdraw** (enter reason) → confirm → check **Labor → By Store → WTD** for that week to confirm the credit dropped.

## Stacked credits

If a No-GM credit is running at the same store at the same time as a GM PTO credit, the store is getting double-credit for the same GM gap. This should be flagged:
- Go to Employee Actions → History for the store
- Look for PTO (GM position, approved) overlapping with an active No-GM tag
- Withdraw the PTO credit if it's wrong (or the No-GM tag if the GM was actually there)

## Close-out (admin)

After a training ends, the admin closes out the request to mark the credit as fully consumed. This prevents the credit from continuing to apply.
