// Hours of Operation — display helpers. Times are stored "HH:MM" (24h local).
import type { DayHours } from "./api";

export const DAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// "07:00" -> "7:00 AM"; null/blank -> "".
export function to12(hhmm: string | null | undefined): string {
  if (!hhmm) return "";
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return "";
  let h = Number(m[1]);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${m[2]} ${ampm}`;
}

// Closing at or before the opening time means it runs past midnight (7AM–2AM).
export function isOvernight(open: string | null, close: string | null): boolean {
  return !!(open && close && close <= open);
}

// A day's hours as a single label for the grid cell.
export function fmtRange(day: DayHours | null | undefined): string {
  if (!day) return "—";
  if (day.is_closed) return "Closed";
  if (!day.open || !day.close) return "—";
  return `${to12(day.open)} - ${to12(day.close)}`;
}
