// Walkthrough review — shared tier + status presentation.

import { cn } from "@/lib/cn";
import type { Tier } from "../types";

const TIER: Record<Tier, { label: string; chip: string; text: string }> = {
  green: { label: "Green", chip: "bg-green-100 text-green-800", text: "text-green-700" },
  yellow: { label: "Yellow", chip: "bg-amber-100 text-amber-800", text: "text-amber-700" },
  red: { label: "Red", chip: "bg-red-100 text-red-700", text: "text-red-700" },
};

export function TierChip({ tier }: { tier: Tier }) {
  const t = TIER[tier];
  return (
    <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide", t.chip)}>
      {t.label}
    </span>
  );
}

export function ScoreBadge({ score, tier }: { score: number; tier: Tier }) {
  return (
    <span className={cn("text-lg font-bold tabular-nums", TIER[tier].text)}>{score}</span>
  );
}

const STATUS: Record<string, { label: string; chip: string }> = {
  submitted: { label: "Submitted", chip: "bg-blue-100 text-blue-700" },
  needs_revision: { label: "Needs revision", chip: "bg-amber-100 text-amber-800" },
  approved: { label: "Approved", chip: "bg-green-100 text-green-800" },
  draft: { label: "Draft", chip: "bg-zinc-100 text-zinc-600" },
  open: { label: "Open", chip: "bg-blue-100 text-blue-700" },
  in_progress: { label: "In progress", chip: "bg-amber-100 text-amber-800" },
  verified: { label: "Awaiting DO", chip: "bg-indigo-100 text-indigo-700" },
  closed: { label: "Closed", chip: "bg-green-100 text-green-800" },
};

export function StatusChip({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, chip: "bg-zinc-100 text-zinc-600" };
  return (
    <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium", s.chip)}>
      {s.label}
    </span>
  );
}

const PRIORITY: Record<string, { label: string; chip: string }> = {
  high: { label: "High", chip: "bg-red-100 text-red-700" },
  med: { label: "Priority", chip: "bg-amber-100 text-amber-800" },
  low: { label: "Low", chip: "bg-zinc-100 text-zinc-600" },
};

export function PriorityChip({ priority }: { priority: string }) {
  const p = PRIORITY[priority] ?? PRIORITY.med;
  return (
    <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium", p.chip)}>
      {p.label}
    </span>
  );
}
