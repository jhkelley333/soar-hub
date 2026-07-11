// Reusable filter chip + search row used above the PAF queue tables.
// Lifts state into the parent so it can decide which filter set is the
// default (e.g. payroll queue hides terminal statuses by default; the
// submitter history shows everything).

import { Search, X } from "lucide-react";
import { Input } from "@/shared/ui/Input";
import { cn } from "@/lib/cn";
import type { PafRow, PafStatus } from "./types";

export interface QueueFilterState {
  status: PafStatus | "ALL";
  query: string;
}

export const ALL_STATUSES: { key: PafStatus | "ALL"; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "Pending", label: "Pending" },
  { key: "Pending SDO Approval", label: "Pending SDO" },
  { key: "Pending VP Approval", label: "Pending VP" },
  { key: "Needs Approval", label: "Needs Approval" },
  { key: "Approved", label: "Approved" },
  { key: "Processed", label: "Processed" },
  { key: "Rejected", label: "Rejected" },
];

export function QueueFilters({
  state,
  onChange,
  available,
  counts,
}: {
  state: QueueFilterState;
  onChange: (next: QueueFilterState) => void;
  /** Optional override for which chips to render. Defaults to all. */
  available?: (PafStatus | "ALL")[];
  /** Per-status row counts to render alongside the chip label. */
  counts: Partial<Record<PafStatus | "ALL", number>>;
}) {
  const visible = available
    ? ALL_STATUSES.filter((s) => available.includes(s.key))
    : ALL_STATUSES;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {visible.map((s) => {
        const active = state.status === s.key;
        const n = counts[s.key];
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onChange({ ...state, status: s.key })}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition",
              active
                ? "bg-midnight text-white"
                : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
            )}
          >
            {s.label}
            {typeof n === "number" && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10px] tabular-nums",
                  active ? "bg-white/15 text-white" : "bg-white text-zinc-600"
                )}
              >
                {n}
              </span>
            )}
          </button>
        );
      })}
      <div className="relative ml-auto w-64">
        <Search
          className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
          strokeWidth={1.75}
        />
        <Input
          type="search"
          value={state.query}
          onChange={(e) => onChange({ ...state, query: e.target.value })}
          placeholder="Employee or last 4 SSN"
          className="pl-7 pr-7"
        />
        {state.query && (
          <button
            type="button"
            onClick={() => onChange({ ...state, query: "" })}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-midnight"
            aria-label="Clear search"
          >
            <X className="h-3 w-3" strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
}

// Apply filter+search to a row list. Pure; no React state.
export function applyFilters(rows: PafRow[], state: QueueFilterState): PafRow[] {
  const q = state.query.trim().toLowerCase();
  return rows.filter((r) => {
    if (state.status !== "ALL" && r.status !== state.status) return false;
    if (q) {
      const hay = `${r.employee_name} ${r.last4_ssn}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// Build the per-status counts shown next to each chip.
export function statusCounts(
  rows: PafRow[]
): Partial<Record<PafStatus | "ALL", number>> {
  const out: Partial<Record<PafStatus | "ALL", number>> = { ALL: rows.length };
  for (const r of rows) {
    out[r.status] = (out[r.status] ?? 0) + 1;
  }
  return out;
}
