// Shared presentation helpers for the mobile Work Orders screens.
// Keeps the tier mapping + age math out of the components so the list
// and the detail view render a ticket the same way.

import type { Tier } from "@/shared/ui/Tier";
import type { Ticket, TicketPriority, TicketStatus } from "../types";
import { APPROVAL_TIERS, isOpenStatus } from "../types";

// Map a ticket to the red/yellow/green vocabulary the rest of the app
// uses. Emergencies and business-critical work read red; urgent reads
// yellow; everything else (and anything already resolved) reads green.
export function ticketTier(t: Pick<Ticket, "priority" | "is_business_critical" | "status">): Tier {
  if (!isOpenStatus(t.status)) return "green";
  if (t.priority === "Emergency" || t.is_business_critical) return "red";
  if (t.priority === "Urgent") return "yellow";
  return "green";
}

// Priority pill palette — small colored chip next to the WO number.
export function priorityChipClass(p: TicketPriority | string | null): string {
  switch (p) {
    case "Emergency": return "bg-sonic-50 text-sonic-700";
    case "Urgent":    return "bg-warn/10 text-warn";
    case "Standard":  return "bg-frost-100 text-midnight-700";
    case "Planned":   return "bg-midnight-50 text-midnight-600";
    default:          return "bg-midnight-50 text-midnight-600";
  }
}

// "3d" / "5h" / "just now" — compact age since submission, for the row.
export function ticketAge(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  return `${days}d`;
}

// Longer relative timestamp for the detail view ("2h ago", "May 12").
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMin = Math.round((Date.now() - then) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatDollars(amount: number | string | null | undefined): string | null {
  if (amount == null || amount === "") return null;
  const n = typeof amount === "number" ? amount : parseFloat(amount);
  if (!Number.isFinite(n)) return null;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// Status filter buckets surfaced on the mobile list. "Open" is the
// default and covers everything that isn't completed/closed/cancelled.
export type WoStatusFilter = "open" | "all" | TicketStatus;

export function matchesStatusFilter(t: Ticket, f: WoStatusFilter): boolean {
  if (f === "all") return true;
  if (f === "open") return isOpenStatus(t.status);
  return t.status === f;
}

// ── Approval helpers (mirror ApprovalSection's server-enforced gate) ──

// roleLevel <= 3 can decide approvals. Kept in sync with the backend
// decideApproval gate and ApprovalSection's client mirror.
const ROLE_LEVEL: Record<string, number> = {
  admin: 1, coo: 1, vp: 1,
  rvp: 2, sdo: 2,
  do: 3,
  gm: 4,
  shift_manager: 5,
  payroll: 6,
};

export function isApprover(role: string | null | undefined): boolean {
  if (!role) return false;
  return (ROLE_LEVEL[role.toLowerCase()] ?? 99) <= 3;
}

// Whole days since submission. Stands in for the design's "days down".
export function daysOpen(iso: string | null | undefined): number {
  if (!iso) return 0;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

// Friendly label for an approval-tier value ("DO < $500" → "DO — under
// $500"). Falls back to the raw value for tiers not in the canonical list.
export function tierLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return APPROVAL_TIERS.find((t) => t.value === value)?.label ?? value;
}

// "8:14a" — compact submission time for the hero stat chip.
export function clockTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ap = h < 12 ? "a" : "p";
  h = h % 12 || 12;
  return `${h}:${m}${ap}`;
}
