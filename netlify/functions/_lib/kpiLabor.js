// Extract per-store labor + sales rows from a KPI feed payload, and resolve the
// feed's business date.

import { isStoreRow, storeNumberOf } from "./kpiOrg.js";

const numOrNull = (v) => (typeof v === "number" && isFinite(v) ? v : null);

// Store-level labor rows shaped for the labor_v2_daily table.
export function extractLaborRows(payload) {
  const rows = Array.isArray(payload?.rawData?.businessDateData) ? payload.rawData.businessDateData : [];
  const out = [];
  for (const r of rows) {
    if (!isStoreRow(r)) continue;
    const number = storeNumberOf(r);
    if (!number) continue;
    out.push({
      store_number: number,
      net_sales: numOrNull(r.netSales),
      labor_cost: numOrNull(r.laborCost),
      labor_hours: numOrNull(r.laborHours),
      overtime_hours: numOrNull(r.overTimeHours),
      labor_pct: numOrNull(r.laborPercentage),
      target_labor_pct: numOrNull(r.targetLaborPercentage),
      variance_target: numOrNull(r.varianceTargetValue),
      scheduled_labor_hours: numOrNull(r.scheduledLaborHours),
      actual_vs_scheduled_hours: numOrNull(r.actualVsScheduledHours),
      splh: numOrNull(r.splh),
    });
  }
  return out;
}

// The feed serves the previous completed business day. Prefer an explicit date
// on the payload if present; otherwise the day before the given Central wall
// clock ({year, month, day}).
export function feedBusinessDate(payload, centralWc) {
  const cands = [
    payload?.businessDate, payload?.date, payload?.asOfDate, payload?.asOf,
    payload?.rawData?.businessDate, payload?.rawData?.date,
  ];
  for (const c of cands) {
    if (typeof c === "string" && /^\d{4}-\d{2}-\d{2}/.test(c)) return c.slice(0, 10);
  }
  const d = new Date(Date.UTC(centralWc.year, centralWc.month - 1, centralWc.day));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Wall-clock parts in a timezone (DST-safe).
export function wallClockInTz(utcDate, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(utcDate);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;
  return { year: +get("year"), month: +get("month"), day: +get("day"), hour };
}
