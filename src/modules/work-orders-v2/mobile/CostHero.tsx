// Midnight "Total requested" hero from the Work Order Approval design.
// Big cost figure + an "Awaiting you" pill when the viewer can decide,
// the requested approval-tier context, and a 3-up stat row
// (Priority / days open / submitted time).
//
// Anchored to our real data: the cost is `cost_estimate` (we have no
// line-item breakdown yet) and the context line is the approval row's
// tier label — NOT the design's placeholder dollar thresholds.

import { AlertTriangle } from "lucide-react";
import type { Ticket, TicketApproval } from "../types";
import { formatDollars, daysOpen, clockTime, tierLabel } from "./woMobile";

export function CostHero({
  ticket,
  latest,
  canDecide,
}: {
  ticket: Ticket;
  latest: TicketApproval | null;
  canDecide: boolean;
}) {
  const amount = formatDollars(ticket.cost_estimate);
  const days = daysOpen(ticket.date_submitted);

  const statusText = canDecide
    ? "Awaiting you"
    : latest
      ? latest.status
      : "No approval yet";

  return (
    <section className="rounded-2xl bg-midnight-900 px-4 py-4 text-white shadow-float">
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-frost-300">
          Total requested
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-frost-100">
          <span className="h-1.5 w-1.5 rounded-full bg-frost-300" />
          {statusText}
        </span>
      </div>

      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="text-[34px] font-semibold leading-none tracking-tight">
          {amount ?? "—"}
        </span>
        {amount && <span className="text-[13px] text-frost-200">USD</span>}
      </div>

      <div className="mt-1 text-[12px] text-frost-200">
        {latest
          ? `Approval tier · ${tierLabel(latest.approval_tier)}`
          : "No approval requested yet"}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat label="Priority">
          <span className="inline-flex items-center gap-1">
            {(ticket.priority === "Emergency" || ticket.is_business_critical) && (
              <AlertTriangle className="h-3.5 w-3.5 text-cherry" strokeWidth={2.25} />
            )}
            {ticket.priority}
          </span>
        </Stat>
        <Stat label="Open">{days} {days === 1 ? "day" : "days"}</Stat>
        <Stat label="Submitted">{clockTime(ticket.date_submitted)}</Stat>
      </div>
    </section>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-white/5 px-2.5 py-2">
      <div className="text-[9.5px] font-semibold uppercase tracking-wider text-frost-300">
        {label}
      </div>
      <div className="mt-0.5 text-[13px] font-medium text-white">{children}</div>
    </div>
  );
}
