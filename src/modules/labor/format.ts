// Formatting + status-display helpers shared by the Labor views.

import type { ChartStatus } from "./types";

export function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return Number(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function fmtMoneyCents(n: number | null | undefined): string {
  if (n == null) return "—";
  return Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${Number(n).toFixed(1)}%`;
}

// Signed value with explicit + sign, for variance/over-chart numbers.
export function fmtSignedPts(n: number | null | undefined): string {
  if (n == null) return "—";
  const v = Number(n);
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)} pts`;
}

export function fmtSignedMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  const v = Number(n);
  return `${v >= 0 ? "+" : ""}${fmtMoney(Math.abs(v)).replace("$", v < 0 ? "-$" : "$")}`;
}

export function fmtSignedHours(n: number | null | undefined): string {
  if (n == null) return "—";
  const v = Number(n);
  return `${v >= 0 ? "+" : ""}${Math.round(v)} hrs`;
}

// Short weekday label for the strip (e.g. "Mon").
export function weekdayShort(iso: string): string {
  const d = parseIsoLocal(iso);
  return d ? d.toLocaleDateString("en-US", { weekday: "short" }) : "";
}

export function dayOfMonth(iso: string): string {
  const d = parseIsoLocal(iso);
  return d ? String(d.getDate()) : "";
}

// Pretty date like "Mon · May 26".
export function fmtDayLabel(iso: string): string {
  const d = parseIsoLocal(iso);
  if (!d) return iso;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// Parse a YYYY-MM-DD as a local calendar date (no TZ shift).
function parseIsoLocal(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// Status → display: label + the SOAR color lane.
export interface StatusDisplay {
  label: string;
  // Tailwind text + bg classes from the design system (sonic=red over,
  // ok=green on-chart).
  text: string;
  bg: string;
  dot: string;
}

export function statusDisplay(status: ChartStatus): StatusDisplay {
  switch (status) {
    case "over":
      return { label: "Over chart", text: "text-sonic-700", bg: "bg-sonic-50", dot: "bg-sonic" };
    case "on":
      return { label: "On chart", text: "text-ok", bg: "bg-frost-100", dot: "bg-ok" };
    default:
      return { label: "No data", text: "text-zinc-500", bg: "bg-zinc-100", dot: "bg-zinc-300" };
  }
}
