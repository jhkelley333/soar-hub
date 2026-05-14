// Horizontal progress indicator showing where a ticket is in the 7-state
// lifecycle. Read-only — the action buttons next to it handle mutation.
// Renders a secondary label for non-`none` pause_state ("Awaiting Parts",
// etc.) so the status pill stays uncluttered.
//
// Visual rules:
//   - Steps before the current state get the muted/done tone.
//   - The current state pill is highlighted.
//   - Steps after get the empty/upcoming tone.
//   - Cancelled is its own terminal track — when the ticket is cancelled,
//     the bar collapses to a single danger pill ("Cancelled").
//   - Closed via store false alarm (closed_by_store=true) shows a small
//     "False Alarm" sublabel so admins can see the close type at a glance.

import { CheckCircle2, Circle, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  type TicketStatus,
  type PauseState,
  statusLabel,
} from "./types";

const HAPPY_PATH: TicketStatus[] = [
  "submitted",
  "in_progress",
  "scheduled",
  "on_site",
  "completed",
  "closed",
];

const PAUSE_LABEL: Record<Exclude<PauseState, "none">, string> = {
  on_hold:              "On Hold",
  awaiting_parts:       "Awaiting Parts",
  awaiting_replacement: "Awaiting Replacement",
};

interface Props {
  status: TicketStatus;
  pauseState?: PauseState | null;
  closedByStore?: boolean;
}

export function StatusBar({ status, pauseState, closedByStore }: Props) {
  // Cancelled — terminal sidecar; collapse the bar.
  if (status === "cancelled") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
        <XCircle className="h-4 w-4" strokeWidth={1.75} />
        <span className="font-medium">Cancelled</span>
        <span className="text-[11px] text-red-700">— no further action</span>
      </div>
    );
  }

  const currentIdx = HAPPY_PATH.indexOf(status);
  const pauseShown = pauseState && pauseState !== "none" && PAUSE_LABEL[pauseState as Exclude<PauseState, "none">];

  return (
    <div className="space-y-1">
      <ol className="flex flex-wrap items-stretch gap-1 text-[11px]">
        {HAPPY_PATH.map((s, i) => {
          const isCurrent = i === currentIdx;
          const isDone    = i < currentIdx;
          const tone =
            isCurrent ? "border-accent bg-accent text-white" :
            isDone    ? "border-zinc-300 bg-zinc-100 text-zinc-700" :
                        "border-zinc-200 bg-white text-zinc-400";
          return (
            <li
              key={s}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "flex flex-1 items-center gap-1.5 rounded-md border px-2 py-1 min-w-0",
                tone,
              )}
            >
              {isDone
                ? <CheckCircle2 className="h-3 w-3 shrink-0" strokeWidth={2} />
                : <Circle       className="h-3 w-3 shrink-0" strokeWidth={1.75} />}
              <span className="truncate font-medium tracking-tight">
                {statusLabel(s)}
              </span>
            </li>
          );
        })}
      </ol>
      {(pauseShown || closedByStore) && (
        <div className="flex flex-wrap items-center gap-1.5 pl-1 text-[10px]">
          {pauseShown && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold uppercase tracking-wide text-amber-900">
              {pauseShown}
            </span>
          )}
          {closedByStore && (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-semibold uppercase tracking-wide text-zinc-600">
              False Alarm
            </span>
          )}
        </div>
      )}
    </div>
  );
}
