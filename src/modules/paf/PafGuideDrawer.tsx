// PAF — in-app user guide, shown in a slide-out drawer from the page header.
// Parity with the Cash Management guide so the team has the reference where
// they work. Plain styled components; no Markdown dependency.

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

export function PafGuideDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="PAF — User Guide"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-1">
        <P>
          A <strong>Personnel Action Form (PAF)</strong> is how leaders submit pay/personnel changes — adjustments, time
          off, terminations, transfers, demotions, bonuses, and salary-leader new hires — for Payroll to process.
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
                <td className="px-3 py-2 font-medium text-midnight">GM</td>
                <td className="px-3 py-2">No access (PAFs start at DO level)</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium text-midnight">DO / SDO / RVP+</td>
                <td className="px-3 py-2">Submit + view their scope; resubmit a rejected one (SDO+ on behalf)</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium text-midnight">SDO / RVP</td>
                <td className="px-3 py-2">Approve/reject bonuses routed to them</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium text-midnight">Payroll / Admin</td>
                <td className="px-3 py-2">Process: reject, request approval, mark processed</td>
              </tr>
            </tbody>
          </table>
        </div>

        <H>The flow</H>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <Li><strong>Standard:</strong> Submit → <em>Pending</em> (Payroll) → <em>Processed</em>.</Li>
          <Li><strong>Bonus</strong> filed by a DO → routes to the area <strong>SDO</strong>; by an SDO → the region <strong>RVP</strong>; RVP+ skip straight to Payroll.</Li>
          <Li>Payroll can mark <strong>Needs Approval</strong> — a 72-hour, single-use email link to an external approver.</Li>
          <Li><strong>Rejected?</strong> The submitter (or an in-scope SDO+) can <strong>Edit &amp; resubmit</strong> the same PAF — it re-enters the flow with its history intact.</Li>
        </ul>

        <H>Filling one out</H>
        <P>
          The store field is <strong>Employee Home Store</strong>. Types: POS Adjustment · Cross-Store Work · PTO ·
          Illness · Backpay · Termination · Transfer · Demotion · Bonus (Spot / Training / Referral) · New Hire (Salary
          Leader). Cost is auto-calculated and shown live; pay-period-end must be a Sunday; last-4 SSN is required.
        </P>

        <H>Emails</H>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <Li>Submitted → Payroll; bonus needs sign-off → the SDO/RVP.</Li>
          <Li>Approved / rejected / processed → the submitter (and the on-behalf editor, if any).</Li>
          <Li>External approval requested → that approver; link clicked → Payroll.</Li>
        </ul>

        <H>Quick tips</H>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <Li>Status chips + search filter your history; export to CSV from the list.</Li>
          <Li>Last-4 SSN shows to in-scope leaders (you have it elsewhere); full SSN is never stored.</Li>
          <Li>A rejected PAF keeps its audit trail — fixing it doesn't start over.</Li>
        </ul>
      </div>
    </Drawer>
  );
}
