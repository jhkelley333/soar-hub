// Cash Management — in-app user guide, rendered in a slide-out drawer from the
// hub header. Content mirrors docs/cash-management-guide.md so the team has the
// reference right where they work (no Drive / repo access needed).

import { Drawer } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/Button";

function H({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-5 text-sm font-bold uppercase tracking-wide text-midnight first:mt-0">{children}</h3>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-[13px] leading-relaxed text-zinc-600">{children}</p>;
}
function Li({ children }: { children: React.ReactNode }) {
  return <li className="text-[13px] leading-relaxed text-zinc-600">{children}</li>;
}

export function CashGuideDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Cash Management — User Guide"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-1">
        <P>
          Cash Management runs the nightly cash cycle: <strong>count the drawer → validate the next-day bank deposit →
          reconcile against the DSR.</strong> Any variance over the tolerance is automatically escalated to the store's
          DO &amp; SDO.
        </P>

        <H>Who can do what</H>
        <div className="mt-2 overflow-hidden rounded-md ring-1 ring-inset ring-zinc-200">
          <table className="w-full text-[12px]">
            <thead className="bg-zinc-50 text-left text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-semibold">Role</th>
                <th className="px-3 py-2 font-semibold">Can do</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 text-zinc-600">
              <tr>
                <td className="px-3 py-2 font-medium text-midnight">Store leaders (GM, managers, crew leader)</td>
                <td className="px-3 py-2">Run closeouts + validate deposits for their store</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium text-midnight">DO / SDO / RVP+</td>
                <td className="px-3 py-2">All of the above + acknowledge/resolve alerts in their scope</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium text-midnight">Accounting</td>
                <td className="px-3 py-2">Read-only review + open deposit slips (all stores)</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium text-midnight">Admin</td>
                <td className="px-3 py-2">Everything, incl. setting the tolerances</td>
              </tr>
            </tbody>
          </table>
        </div>

        <H>1) Night Closeout</H>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <Li><strong>Count the drawer</strong> — enter the quantity per denomination; the Counted total adds up live.</Li>
          <Li><strong>Cash due</strong> — the amount expected per today's DSR (type it in).</Li>
          <Li><strong>Deposit amount</strong> — auto-matches the counted total; override if the deposit differs.</Li>
          <Li><strong>Variance</strong> shows live — green balanced, amber within tolerance, <span className="font-semibold text-red-700">red over tolerance</span>.</Li>
          <Li>Over the tolerance → a <strong>reason is required</strong> and submitting <strong>alerts your DO &amp; SDO</strong>.</Li>
        </ol>

        <H>2) Deposit Validation (next day)</H>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <Li><strong>Deposit slip photo</strong> — attach the bank-stamped slip (required; kept for audit).</Li>
          <Li><strong>Amount credited by bank</strong> — entered and matched vs. the expected deposit; a mismatch over tolerance needs a reason.</Li>
          <Li>
            <strong>Carried over from DSR</strong> — enter the open guest checks carried over from yesterday's DSR: a
            <strong> count</strong> and a <strong>dollar value</strong>. Leave at 0 if none.
          </Li>
        </ul>
        <div className="mt-2 rounded-md bg-amber-50 p-3 text-[12px] leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-200">
          <strong>Carried Over (Micros DSR):</strong> open checks/tabs from the prior business day still open when today
          began. High carryover can flag checks left open (drive-thru voids not completed, training/system issues) and
          shrinkage exposure; those dollars aren't new sales, so they're reconciled separately. A nonzero entry must be
          ticked <em>"recorded &amp; addressed"</em> and also alerts the DO &amp; SDO.
        </div>

        <H>3) Discrepancy Alerts</H>
        <P>
          Every over-tolerance closeout/deposit and every carried-over entry is routed here to the store's DO &amp; SDO.
          Summary counts show Open · Acknowledged · Resolved. <strong>DO/SDO and above</strong> can Acknowledge → Mark
          resolved; GMs see it read-only.
        </P>

        <H>4) DSR &amp; Carried Over</H>
        <P>
          A running ledger of recent business days — Cash due, Deposit, Variance, Carried over (open checks: count · $),
          and deposit status. <strong>Detail</strong> on any row opens the full breakdown and a <strong>View deposit
          slip</strong> button for review.
        </P>

        <H>Settings (Admin only)</H>
        <P>
          Two variance tolerances drive every page — one for <strong>Night Closeout</strong>, one for <strong>Deposit
          Validation</strong>. Change them once on the Settings tab and they apply everywhere. Default is $5 each.
        </P>

        <H>Quick tips</H>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <Li>Amounts are entered in dollars (e.g. 3180.00); the system handles the math.</Li>
          <Li>The deposit field tracks the counted total — only override it if the actual deposit differs.</Li>
          <Li>Ledger entries are immutable once submitted; adjustments post as new rows.</Li>
          <Li>Multi-store leaders: use the store selector (top-right) to switch stores.</Li>
        </ul>
      </div>
    </Drawer>
  );
}
