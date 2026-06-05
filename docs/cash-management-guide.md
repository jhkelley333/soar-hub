# SOAR Cash Management — User Guide

Cash Management is the hub for the nightly cash cycle: **count the drawer → validate the
next-day bank deposit → reconcile against the DSR.** Any variance over the tolerance is
automatically escalated to the store's DO & SDO. Find it in the sidebar under
**Cash Management** (`/admin/cash-management`).

## Who can do what

| Role | Run closeout / validate deposit | Acknowledge / resolve alerts | Review + open deposit slips | Set tolerances |
|---|:--:|:--:|:--:|:--:|
| **Store leaders** (GM, shift / first-assistant / associate manager, crew leader) | ✅ their store | — | their store | — |
| **DO / SDO** | ✅ their scope | ✅ | their scope | — |
| **RVP / VP / COO** | ✅ | ✅ | org-wide | — |
| **Accounting** | — | — | ✅ org-wide (read-only) | — |
| **Admin** | ✅ | ✅ | ✅ | ✅ |

*Payroll, HR, Facilities, and crew/carhop don't have access.*

## The nightly cycle

```
 Night Closeout  ──►  Deposit Validation  ──►  DSR & Carried Over (ledger)
 (count + deposit)    (next day: bank + slip)        (running record)
        │                       │
        └──── variance over tolerance ────►  Discrepancy Alert → DO & SDO (email + in-app)
```

## 1) Night Closeout

1. **Count the drawer** — enter the quantity of each denomination; the **Counted total** adds up live.
2. **Cash due** — the amount expected per today's DSR (type it in).
3. **Deposit amount** — auto-matches the counted total; override if the deposit differs
   ("Match counted" snaps it back).
4. **Variance** shows live: green = balanced, amber = within tolerance, **red = over tolerance**.
5. If it's **over the tolerance**, a **reason is required** and submitting **alerts your DO & SDO**.
   Confirm to submit.

## 2) Deposit Validation (next day)

The prior night's deposit appears here. To verify, complete the checklist:

- **Deposit slip photo** — attach the bank-stamped slip (required; stored to the audit log).
- **Amount credited by bank** — entered, then matched against the expected deposit. A mismatch
  over tolerance needs a reason.
- **Carried over from DSR** — *enter the open guest checks carried over from yesterday's DSR:*
  a **count** and a **dollar value** (tap the ⓘ for the definition). Leave at **0** if none.
  - **ⓘ Carried Over (Micros DSR):** open checks/tabs from the prior business day still open when
    today began. High carryover can flag checks left open (drive-thru voids not completed,
    training/system issues) and shrinkage exposure; those dollars aren't new sales, so they're
    reconciled separately.
  - If nonzero, tick **"recorded & addressed"** — this also raises an alert to the DO & SDO to review.
- **Verify** unlocks once every item is complete.

## 3) Discrepancy Alerts

Every over-tolerance closeout/deposit and every carried-over entry lands here, routed to the
store's **DO & SDO**.

- Summary counts: **Open · Acknowledged · Resolved.**
- Open an alert to see the variance, the manager's note, and the **escalation timeline**.
- **DO/SDO (and above)** can **Acknowledge → Mark resolved.** GMs see it read-only.

## 4) DSR & Carried Over

A running ledger of recent business days: **Cash due · Deposit · Variance ·
Carried over (open checks: count · $) · Deposit status.**

- The **Carried over (open checks)** summary + banner show the period totals flagged for review.
- **Detail** on any row opens the full closeout + deposit breakdown and a **View deposit slip**
  button (for accounting review).

## Settings (Admin only)

Two **variance tolerances** drive every page — one for **Night Closeout**, one for
**Deposit Validation**. Change them once on the Settings tab and they apply everywhere
immediately. Default is **$5** each.

## Notifications

When a variance breaches tolerance — or open checks are carried over — the store's **DO & SDO**
get an **email** plus an **in-app discrepancy alert**. Slip photos and reasons are kept on the
deposit for the audit trail.

## Quick tips

- Amounts are entered in dollars (e.g. `3180.00`); the system handles the math.
- The deposit field tracks your counted total automatically — only override it if the actual
  deposit differs.
- Nothing is "final" until submitted; ledger entries are immutable after submission
  (adjustments post as new rows).
- Multi-store leaders: use the **store selector** in the top-right to switch which store you're
  working in.
