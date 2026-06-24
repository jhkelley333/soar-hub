// SOAR fiscal calendar (FY2026, 4-4-5) — server-side port of src/lib/fiscal.ts.
// Mon–Sun weeks, 12 periods, FY starts Mon Dec 29, 2025. Used to decide when a
// fiscal week / period CLOSES so Labor v2 can snapshot the final WTD/PTD.
// To roll to a new year, add the next FY block (start + periodWeeks).

const DAY = 86400000;

const FY = {
  label: "FY2026",
  startIso: "2025-12-29", // Mon
  periodWeeks: [4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 5],
};

function parseIso(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
}
function isoOf(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

const FY_START = parseIso(FY.startIso);
const PERIODS = [];
{
  let sw = 0;
  for (let i = 0; i < 12; i++) {
    const w = FY.periodWeeks[i];
    PERIODS.push({
      num: i + 1,
      quarter: Math.floor(i / 3) + 1,
      weeks: w,
      startWeek: sw,
      startMs: FY_START + sw * 7 * DAY,
      endMs: FY_START + ((sw + w) * 7 - 1) * DAY, // last day = closing Sunday
    });
    sw += w;
  }
}
const TOTAL_WEEKS = PERIODS.reduce((a, p) => a + p.weeks, 0);

// Fiscal context for an ISO date (YYYY-MM-DD), or null if outside the FY.
// isWeekEnd/isPeriodEnd flag the closing day (the Sunday that ends the
// fiscal week / period), which is when we snapshot the final WTD/PTD.
export function fiscalForDate(iso) {
  const ms = parseIso(iso);
  if (ms == null) return null;
  const days = Math.round((ms - FY_START) / DAY);
  if (days < 0 || days >= TOTAL_WEEKS * 7) return null;
  const wk = Math.floor(days / 7);
  const p = PERIODS.find((x) => wk >= x.startWeek && wk < x.startWeek + x.weeks);
  if (!p) return null;
  const weekStartMs = FY_START + wk * 7 * DAY;
  const weekEndMs = weekStartMs + 6 * DAY;
  const day = iso.slice(0, 10);
  return {
    fiscalYear: FY.label,
    period: p.num,
    quarter: p.quarter,
    fiscalWeek: wk + 1,
    weekInPeriod: wk - p.startWeek + 1,
    weekStart: isoOf(weekStartMs),
    weekEnd: isoOf(weekEndMs),
    periodStart: isoOf(p.startMs),
    periodEnd: isoOf(p.endMs),
    isWeekEnd: isoOf(weekEndMs) === day,
    isPeriodEnd: isoOf(p.endMs) === day,
  };
}
