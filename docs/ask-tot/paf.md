# PAF (Payroll Adjustment Form)

## Where to find it

- Sidebar → **PAF** (`/paf`) — submission queue; DO, Payroll, Admin
- **PAF Archive** (`/paf/archive`) — full record + CSV export; Payroll, Admin
- RVP and above can ask Tot about PAF counts and status

## Who can submit

- GM and above: submit for their store
- SDO/RVP required for **Pay Adjustment (Salary)** and **New Hire (Salary Leader)** forms (offer letters, salary increases)
- Drive-in = the store being charged. Must be in the submitter's visible scope.

## Form categories

| Category | Description |
|---|---|
| Backpay | Missed pay or make-up wages |
| Overtime | OT pay not captured by payroll |
| Cross Store Work | Team member worked at another location |
| Bonus | Performance, referral, or training bonuses |
| New Hire | Standard hourly new hire |
| New Hire (Salary Leader) | SDO+ only; includes offer letter |
| Pay Adjustment (Salary) | Salary change; SDO+ only |
| Paid Sick | Illinois Paid Sick Leave |
| Training | Training hours pay (distinct from training credits) |
| PTO | PTO payout |

## Status flow

```
Pending → Needs Approval (email sent) → Approved → Processed
Pending → Rejected (by DO/SDO/RVP/admin)
Pending SDO Approval → needs SDO/RVP sign-off
Pending VP Approval  → needs VP/COO sign-off
```

Short-notice GM requests (< 30 days) skip the DO step and go straight to SDO/RVP.

## Approval hierarchy

1. DO approves first (non-short-notice, non-salary)
2. SDO/RVP approves → triggers Resend email to Payroll
3. Payroll marks Processed after journal entry
4. VP/COO required for "Pending VP Approval" status

## Key rules

- **Processed ≠ stopped.** A credit running in the background continues until Withdrawn or Deleted (admin). The status going to "Processed" is a payroll acknowledgment, not a credit stop.
- `last4_ssn` is on the record but Ask Tot never shows it.
- Ask Tot is **read-only** for PAF — it shows counts and status, but cannot approve, reject, or process.
- To approve a PAF: PAF queue at `/paf` → open the record → Approve / Reject button.

## Estimated cost

The estimated cost field (`estimated_cost`) is calculated on submit based on hours × wage. It is an estimate only — final payroll journal entry may differ.

## Stacked credit risk

When a GM PTO credit (from Employee Actions) runs at the same time as a No-GM credit for the same store, the store gets double credit for the same GM gap. Check Employee Actions → History → look for PTO overlapping with an active No-GM tag.
