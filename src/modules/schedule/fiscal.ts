// SOAR fiscal calendar model (FY2026, 4-4-5), validated against the 2026
// QSR payroll calendar PDF. The Schedule overlays markers derived from this
// onto the month grid: a period/week rail, A/B paydays, period closes, and
// closed holidays. Positions are derived from dates, never stored.
//
// Fiscal model:
//   - 4-4-5 layout, Mon–Sun weeks, 12 periods / 4 quarters, 52 weeks
//   - FY starts Mon Dec 29, 2025; ends Sun Dec 27, 2026
//   - Two staggered biweekly payrolls (A, B); period ends Sunday, payday is
//     the Friday +5 days; a payday on a closed holiday pulls forward one day.
// To roll to a new year, change start + the two payday anchors + holidays.

const FY = {
  label: "FY2026",
  start: new Date(2025, 11, 29), // Mon Dec 29, 2025
  periodWeeks: [4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 5],
  payAnchorA: new Date(2026, 0, 25), // an "A" pay-period-end Sunday
  payAnchorB: new Date(2026, 0, 18), // a "B" pay-period-end Sunday
  holidays: { "2026-11-26": "Thanksgiving", "2026-12-25": "Christmas" } as Record<string, string>,
};

// ── local, DST-safe date helpers ──────────────────────────────────────────
const addDays = (d: Date, n: number): Date => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
};
const fkey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const diffDays = (a: Date, b: Date): number =>
  Math.round(
    (new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime() -
      new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()) /
      86400000,
  );

export interface FiscalPeriod {
  num: number;
  quarter: number;
  weeks: number;
  startWeek: number;
  start: Date;
  end: Date;
}
export interface Payday {
  cycle: "A" | "B";
  moved: boolean;
}
export interface FiscalInfo {
  period: number;
  quarter: number;
  fiscalWeek: number;
  weekInPeriod: number;
}

function buildModel() {
  const periods: FiscalPeriod[] = [];
  let sw = 0;
  for (let i = 0; i < 12; i++) {
    const w = FY.periodWeeks[i];
    periods.push({
      num: i + 1,
      quarter: Math.floor(i / 3) + 1,
      weeks: w,
      startWeek: sw,
      start: addDays(FY.start, sw * 7),
      end: addDays(FY.start, (sw + w) * 7 - 1),
    });
    sw += w;
  }
  const totalWeeks = sw;
  const fyEnd = periods[periods.length - 1].end;

  const closes: Record<string, number> = {};
  periods.forEach((p) => (closes[fkey(p.end)] = p.num));

  const paydays: Record<string, Payday> = {};
  ([
    { cycle: "A" as const, end: FY.payAnchorA },
    { cycle: "B" as const, end: FY.payAnchorB },
  ]).forEach((c) => {
    for (let k = -3; k < 33; k++) {
      const end = addDays(c.end, k * 14);
      let pay = addDays(end, 5);
      let moved = false;
      if (FY.holidays[fkey(pay)]) {
        pay = addDays(pay, -1);
        moved = true;
      }
      paydays[fkey(pay)] = { cycle: c.cycle, moved };
    }
  });

  return { periods, totalWeeks, fyEnd, closes, paydays };
}

const MODEL = buildModel();

export const FISCAL = {
  label: FY.label,
  start: FY.start,
  end: MODEL.fyEnd,
  totalWeeks: MODEL.totalWeeks,
};

// Period / fiscal-week info for a date, or null if outside the fiscal year.
export function fiscalInfo(date: Date): FiscalInfo | null {
  const days = diffDays(date, FY.start);
  if (days < 0 || days >= MODEL.totalWeeks * 7) return null;
  const wk = Math.floor(days / 7);
  const p = MODEL.periods.find((x) => wk >= x.startWeek && wk < x.startWeek + x.weeks);
  if (!p) return null;
  return {
    period: p.num,
    quarter: p.quarter,
    fiscalWeek: wk + 1,
    weekInPeriod: wk - p.startWeek + 1,
  };
}

export const dateKey = fkey;
export const closeOn = (key: string): number | null => MODEL.closes[key] ?? null;
export const paydayOn = (key: string): Payday | null => MODEL.paydays[key] ?? null;
export const holidayOn = (key: string): string | null => FY.holidays[key] ?? null;
