// Report engine — shared date helpers. Weekly reports anchor on the prior full
// Mon-Sun week relative to "now" in the report's timezone.

import { wallClock } from "./core.js";

const ymd = (d) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

// The prior full Mon-Sun week. Returns ISO dates plus weekEndExclusive (the
// Monday after) for timestamptz range filters like approved_at < weekEndExclusive.
export function priorWeek(now, tz = "America/Chicago") {
  const wc = wallClock(now, tz);
  const today = new Date(Date.UTC(wc.year, wc.month - 1, wc.day, 12));
  const sinceMonday = (wc.dow + 6) % 7; // dow: Sun=0..Sat=6
  const thisMonday = new Date(today); thisMonday.setUTCDate(today.getUTCDate() - sinceMonday);
  const start = new Date(thisMonday); start.setUTCDate(thisMonday.getUTCDate() - 7);
  const end = new Date(start); end.setUTCDate(start.getUTCDate() + 6);
  const endExclusive = new Date(start); endExclusive.setUTCDate(start.getUTCDate() + 7);
  return { weekStart: ymd(start), weekEnd: ymd(end), weekEndExclusive: ymd(endExclusive) };
}
