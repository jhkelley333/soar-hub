// Work Orders — in-app user guide, shown in a slide-out drawer from the
// page header. Parity with the PAF and Cash Management guides so the team
// has the reference where they work. Plain styled components; no Markdown.

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

export function WorkOrdersGuideDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Work Orders — User Guide"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-1">
        <P>
          <strong>Work Orders</strong> is where every store's facilities and equipment requests live — from submitting a
          broken-freezer ticket to routing it to a vendor, approving the cost, and confirming the fix. Stores, vendors,
          and internal staff all collaborate on the same ticket.
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
                <td className="px-3 py-2 font-medium text-midnight">Store team (GM, managers, crew)</td>
                <td className="px-3 py-2">Submit tickets, add photos/comments, confirm or reopen the fix</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium text-midnight">DO / SDO+</td>
                <td className="px-3 py-2">Everything above across their scope, plus cost approvals within their limit</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium text-midnight">RVP+ (RVP, VP, COO, Admin)</td>
                <td className="px-3 py-2">Settings: issue library, troubleshooting, email templates, vendor QR, PM, approval limits, legacy import</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium text-midnight">Vendors</td>
                <td className="px-3 py-2">Update assigned tickets via the vendor portal link/QR (no login)</td>
              </tr>
            </tbody>
          </table>
        </div>

        <H>The lifecycle</H>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <Li><strong>Submitted</strong> → <strong>In Progress</strong> → <strong>Scheduled</strong> → <strong>On Site</strong> → <strong>Completed</strong> → <strong>Closed</strong>.</Li>
          <Li>A ticket can pause as <strong>Awaiting Equipment</strong> or <strong>Parts on Order</strong> while a replacement/part is on its way, then resume.</Li>
          <Li>When a vendor marks a ticket <strong>Completed</strong>, it waits on the store to <strong>Confirm Fix</strong> (closes it) or <strong>Reopen — Not Fixed</strong> (sends it back).</Li>
          <Li><strong>Cancelled</strong> closes a ticket that's no longer needed.</Li>
        </ul>

        <H>Submitting a ticket</H>
        <P>
          Click <strong>New Ticket</strong>, pick the store and category, describe the issue, and set a priority:
          <strong> Emergency</strong> · <strong>Urgent</strong> · <strong>Standard</strong> · <strong>Planned</strong>.
          Flag <strong>Business Critical</strong> when the store can't operate (e.g. POS or walk-in down) — those are
          surfaced at the top of the queue. Attach photos and pick the issue from the library for faster routing.
        </P>

        <H>Approvals</H>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <Li>Costs above a role's <strong>approval limit</strong> route up the chain until someone with authority signs off.</Li>
          <Li>Admins set the limits per role under <strong>Settings → Approval Limits</strong>.</Li>
          <Li>The ticket's Approval panel shows who's pending and records each decision.</Li>
        </ul>

        <H>Vendors</H>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <Li>Assign a vendor on the ticket; they get a secure portal link to update status, post quotes, and mark work done — no account needed.</Li>
          <Li><strong>My Store QR</strong> prints a code stores can post on equipment so a tech can pull up the right ticket fast.</Li>
        </ul>

        <H>Staying in sync</H>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <Li>Each ticket has two chat threads — <strong>Internal</strong> (your team) and <strong>Vendor</strong> — plus an activity feed of every status change.</Li>
          <Li>The bell shows unread ticket messages; a badge on a ticket means new activity since you last looked.</Li>
          <Li>Filter the queue by status, priority, category, or search; toggle <strong>Open only</strong> to hide closed work.</Li>
          <Li><strong>Replacements</strong> lists every ticket where new equipment was ordered — a running record of what's been replaced.</Li>
        </ul>

        <H>Quick tips</H>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <Li>Tickets aging past 15 days are flagged red — clear or update them so nothing stalls.</Li>
          <Li><strong>Copy link</strong> on a ticket shares a deep link straight to it.</Li>
          <Li>Preventive Maintenance (Settings) auto-generates recurring tickets so routine upkeep never gets forgotten.</Li>
        </ul>
      </div>
    </Drawer>
  );
}
