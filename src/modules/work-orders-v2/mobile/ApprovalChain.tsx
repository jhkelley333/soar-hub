// Approval-chain block from the WO Approval design — a vertical stepper
// of who has acted and who's next.
//
// Our model is tier-based (one approval row at a time), not a fixed
// multi-role chain, so this renders what we actually know: the submitter,
// then the current/last approval row (pending / approved / rejected),
// with a "You" badge when the viewer is the approver. The design's
// fixed GM→DO→SDO ladder with thresholds would need the schema work
// from the "Multi-step chain" slice.

import { Check, X } from "lucide-react";
import { Avatar } from "@/shared/ui/Avatar";
import { cn } from "@/lib/cn";
import type { Ticket, TicketApproval } from "../types";
import { relativeTime, tierLabel } from "./woMobile";

export function ApprovalChain({
  ticket,
  latest,
  canDecide,
}: {
  ticket: Ticket;
  latest: TicketApproval | null;
  canDecide: boolean;
}) {
  const submitter = ticket.submitted_by || "Submitter";

  return (
    <div className="bg-surface rounded-xl ring-1 ring-midnight-100 shadow-card p-4">
      <ol className="space-y-0">
        <Step
          done
          name={submitter}
          line={`Submitted · ${relativeTime(ticket.date_submitted)}`}
          last={!latest}
        />

        {latest && (
          <Step
            tone={
              latest.status === "Approved"
                ? "done"
                : latest.status === "Rejected"
                  ? "rejected"
                  : "pending"
            }
            name={latest.approved_by || tierLabel(latest.approval_tier)}
            badge={canDecide ? "You" : undefined}
            line={
              latest.status === "Pending"
                ? `Awaiting approval · ${tierLabel(latest.approval_tier)}`
                : `${latest.status} · ${relativeTime(latest.approved_at ?? latest.requested_at)}`
            }
            last
          />
        )}
      </ol>
    </div>
  );
}

type Tone = "done" | "pending" | "rejected";

function Step({
  done,
  tone,
  name,
  line,
  badge,
  last,
}: {
  done?: boolean;
  tone?: Tone;
  name: string;
  line: string;
  badge?: string;
  last?: boolean;
}) {
  const t: Tone = done ? "done" : tone ?? "pending";
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {!last && (
        <span className="absolute left-[15px] top-8 bottom-0 w-px bg-midnight-100" aria-hidden />
      )}
      <Node tone={t} name={name} />
      <div className="min-w-0 pt-0.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[13.5px] font-semibold text-midnight-900 truncate">
            {name}
          </span>
          {badge && (
            <span className="rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
              {badge}
            </span>
          )}
        </div>
        <div className="text-[11.5px] text-midnight-500">{line}</div>
      </div>
    </li>
  );
}

function Node({ tone, name }: { tone: Tone; name: string }) {
  if (tone === "done") {
    return (
      <span className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ok text-white">
        <Check className="h-4 w-4" strokeWidth={2.5} />
      </span>
    );
  }
  if (tone === "rejected") {
    return (
      <span className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cherry text-white">
        <X className="h-4 w-4" strokeWidth={2.5} />
      </span>
    );
  }
  // pending — accent-ringed avatar
  return (
    <span
      className={cn(
        "z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-2 ring-accent ring-offset-2 ring-offset-surface",
      )}
    >
      <Avatar name={name} size={32} />
    </span>
  );
}
