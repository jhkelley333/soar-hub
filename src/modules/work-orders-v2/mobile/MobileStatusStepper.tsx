// Compact status stepper for the mobile work-order detail. Shows the
// current lifecycle stage + a segmented progress bar, surfacing the
// conditional "Pending Approval" / "Parts on Order" states (amber) only
// when the ticket is actually in them — mirroring the desktop pipeline,
// but sized for a phone.

import { cn } from "@/lib/cn";

type Stage = { key: string; label: string; cond?: boolean };

const BASE: Array<[string, string]> = [
  ["submitted", "Submitted"],
  ["scheduled", "Scheduled"],
  ["on_site", "On Site"],
  ["in_progress", "In Progress"],
  ["completed", "Completed"],
  ["closed", "Closed"],
];

function buildStages(approvalPending: boolean, partsOnOrder: boolean): Stage[] {
  const out: Stage[] = [];
  for (const [key, label] of BASE) {
    if (key === "in_progress" && approvalPending) {
      out.push({ key: "approval", label: "Pending Approval", cond: true });
    }
    out.push({ key, label });
    if (key === "in_progress" && partsOnOrder) {
      out.push({ key: "parts", label: "Parts on Order", cond: true });
    }
  }
  return out;
}

function currentKey(status: string, approvalPending: boolean, partsOnOrder: boolean): string {
  if (partsOnOrder) return "parts";
  if (approvalPending) return "approval";
  switch (status) {
    case "submitted": return "submitted";
    case "scheduled": return "scheduled";
    case "on_site": return "on_site";
    case "in_progress":
    case "awaiting_equipment": return "in_progress";
    case "completed": return "completed";
    case "closed":
    case "cancelled": return "closed";
    default: return "submitted";
  }
}

export function MobileStatusStepper({
  status,
  approvalPending = false,
  partsOnOrder = false,
}: {
  status: string;
  approvalPending?: boolean;
  partsOnOrder?: boolean;
}) {
  const cancelled = status === "cancelled";
  const stages = buildStages(approvalPending, partsOnOrder);
  const cur = Math.max(
    0,
    stages.findIndex((s) => s.key === currentKey(status, approvalPending, partsOnOrder)),
  );
  const currentStage = stages[cur];
  const isCond = !!currentStage?.cond;
  const label = cancelled ? "Cancelled" : currentStage?.label ?? "Submitted";

  return (
    <section className="bg-surface rounded-xl ring-1 ring-midnight-100 shadow-card px-4 py-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-midnight-400">
            Status
          </div>
          <div
            className={cn(
              "text-[15px] font-semibold",
              cancelled ? "text-midnight-500" : isCond ? "text-amber-700" : "text-midnight-900",
            )}
          >
            {label}
          </div>
        </div>
        <div className="text-[11px] font-medium tabular-nums text-midnight-400">
          {cancelled ? "—" : `${cur + 1} of ${stages.length}`}
        </div>
      </div>
      <div className="mt-2.5 flex gap-1">
        {stages.map((s, i) => {
          const filled = !cancelled && i <= cur;
          const isCurr = !cancelled && i === cur;
          return (
            <div
              key={s.key}
              className={cn(
                "h-1.5 flex-1 rounded-full",
                !filled && "bg-midnight-100",
                filled && (s.cond || (isCurr && isCond) ? "bg-amber-500" : "bg-accent"),
              )}
            />
          );
        })}
      </div>
    </section>
  );
}
