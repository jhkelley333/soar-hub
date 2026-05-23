// Approval-chain stepper from the WO Approval design: who submitted,
// who's deciding now, and who's next if it escalates.
//
// Grounded in our REAL approval tiers (APPROVAL_TIERS: DO → SDO → RVP
// with their dollar bands) rather than the design's placeholder
// thresholds. This is the visual ladder only — actual auto-escalation
// (creating the next tier's approval when an amount exceeds the current
// approver's authority) is a backend follow-up pending finance sign-off
// on the bands.

import { Check, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { APPROVAL_TIERS, type Ticket, type TicketApproval } from "../types";
import { relativeTime, tierLabel } from "./woMobile";

// "DO — under $500" → { role: "DO", threshold: "under $500" }
function splitTierLabel(value: string | null | undefined) {
  const label = tierLabel(value);
  const [role, threshold] = label.split(" — ");
  return { role: role || "Approver", threshold: threshold || label };
}

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

  const curIdx = latest
    ? APPROVAL_TIERS.findIndex((t) => t.value === latest.approval_tier)
    : -1;
  const cur = latest ? splitTierLabel(latest.approval_tier) : null;
  const nextTier =
    latest?.status === "Pending" && curIdx >= 0 && curIdx < APPROVAL_TIERS.length - 1
      ? APPROVAL_TIERS[curIdx + 1]
      : null;
  const next = nextTier ? splitTierLabel(nextTier.value) : null;

  const curTone: Tone = !latest
    ? "pending"
    : latest.status === "Approved"
      ? "done"
      : latest.status === "Rejected"
        ? "rejected"
        : "pending";

  return (
    <div className="bg-surface rounded-xl ring-1 ring-midnight-100 shadow-card p-4">
      <ol className="space-y-0">
        <Step
          tone="done"
          abbr="GM"
          name={submitter}
          line={`Submitted · ${relativeTime(ticket.date_submitted)}`}
          last={!latest}
        />

        {latest && cur && (
          <Step
            tone={curTone}
            abbr={cur.role}
            name={latest.approved_by || `${cur.role} approval`}
            badge={canDecide ? "You" : undefined}
            line={
              latest.status === "Pending"
                ? `Awaiting approval · ${cur.threshold}`
                : `${latest.status} · ${relativeTime(latest.approved_at ?? latest.requested_at)}`
            }
            last={!next}
          />
        )}

        {next && (
          <Step
            tone="upcoming"
            abbr={next.role}
            name={`${next.role} approval`}
            line={`Next — only if escalated · ${next.threshold}`}
            last
          />
        )}
      </ol>
    </div>
  );
}

type Tone = "done" | "pending" | "rejected" | "upcoming";

function Step({
  tone,
  abbr,
  name,
  line,
  badge,
  last,
}: {
  tone: Tone;
  abbr: string;
  name: string;
  line: string;
  badge?: string;
  last?: boolean;
}) {
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {!last && (
        <span className="absolute left-[15px] top-8 bottom-0 w-px bg-midnight-100" aria-hidden />
      )}
      <Node tone={tone} abbr={abbr} />
      <div className="min-w-0 pt-0.5">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "text-[13.5px] font-semibold truncate",
              tone === "upcoming" ? "text-midnight-500" : "text-midnight-900",
            )}
          >
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

function Node({ tone, abbr }: { tone: Tone; abbr: string }) {
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
  if (tone === "upcoming") {
    return (
      <span className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-midnight-100 text-[10px] font-semibold text-midnight-500">
        {abbr}
      </span>
    );
  }
  // pending — the active approver
  return (
    <span className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-white ring-2 ring-accent ring-offset-2 ring-offset-surface">
      {abbr}
    </span>
  );
}
