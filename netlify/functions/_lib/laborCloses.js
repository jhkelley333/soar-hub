// Snapshot the final WTD/PTD labor numbers when a fiscal week / period closes.
// Driven off the fiscal calendar: when a captured business_date is a fiscal
// week end, each store's WTD band is the closing week; when it's a period end,
// the PTD band is the closing period. Upsert keyed by fiscal identifiers, so
// re-running (the hourly captures, or a revision) just refreshes the close.

import { fiscalForDate } from "./fiscal.js";

// rows: the extracted labor rows (with wtd_*/ptd_* bands) for `businessDate`.
// Returns { weeks, periods } counts of close rows written.
export async function upsertLaborCloses(supa, rows, businessDate) {
  const fi = fiscalForDate(businessDate);
  if (!fi) return { weeks: 0, periods: 0 };
  const now = new Date().toISOString();
  let weeks = 0;
  let periods = 0;

  if (fi.isWeekEnd) {
    const weekRows = rows
      .filter((r) => r.wtd_net_sales != null)
      .map((r) => ({
        store_number: r.store_number,
        fiscal_year: fi.fiscalYear,
        fiscal_week: fi.fiscalWeek,
        period: fi.period,
        week_in_period: fi.weekInPeriod,
        week_start: fi.weekStart,
        week_end: fi.weekEnd,
        business_date: businessDate,
        net_sales: r.wtd_net_sales,
        labor_cost: r.wtd_labor_cost,
        labor_hours: r.wtd_labor_hours,
        labor_pct: r.wtd_labor_pct,
        target_labor_pct: r.wtd_target_labor_pct,
        captured_at: now,
      }));
    if (weekRows.length) {
      const { error } = await supa.from("labor_v2_week_close").upsert(weekRows, { onConflict: "store_number,fiscal_year,fiscal_week" });
      if (error) throw new Error(`week-close upsert failed: ${error.message}`);
      weeks = weekRows.length;
    }
  }

  if (fi.isPeriodEnd) {
    const periodRows = rows
      .filter((r) => r.ptd_net_sales != null)
      .map((r) => ({
        store_number: r.store_number,
        fiscal_year: fi.fiscalYear,
        period: fi.period,
        quarter: fi.quarter,
        period_start: fi.periodStart,
        period_end: fi.periodEnd,
        business_date: businessDate,
        net_sales: r.ptd_net_sales,
        labor_cost: r.ptd_labor_cost,
        labor_hours: r.ptd_labor_hours,
        labor_pct: r.ptd_labor_pct,
        target_labor_pct: r.ptd_target_labor_pct,
        captured_at: now,
      }));
    if (periodRows.length) {
      const { error } = await supa.from("labor_v2_period_close").upsert(periodRows, { onConflict: "store_number,fiscal_year,period" });
      if (error) throw new Error(`period-close upsert failed: ${error.message}`);
      periods = periodRows.length;
    }
  }

  return { weeks, periods };
}
