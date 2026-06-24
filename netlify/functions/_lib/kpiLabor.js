// Extract per-store labor + sales rows from a KPI feed payload, and resolve the
// feed's business date.

import { isStoreRow, storeNumberOf } from "./kpiOrg.js";

const numOrNull = (v) => (typeof v === "number" && isFinite(v) ? v : null);

// The feed names its period sections a few different ways; mirror kpi-snapshot.
const WTD_SECTIONS = ["weekToDateData", "weekToDate", "wtdData", "businessWeekData", "weekData", "wtd"];
const PTD_SECTIONS = ["periodToDateData", "periodToDate", "ptdData", "businessPeriodData", "periodData", "ptd"];

function pickSection(rd, cands) {
  for (const k of cands) if (Array.isArray(rd[k])) return rd[k];
  return [];
}

// Map a period's store rows by store number, for joining onto the daily rows.
function storeRowsByNumber(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!isStoreRow(r)) continue;
    const number = storeNumberOf(r);
    if (number) m.set(number, r);
  }
  return m;
}

// Store-level labor rows shaped for the labor_v2_daily table. The daily slice
// drives the row set; WTD + PTD bands are joined on store number so the GM view
// can render all three cards (goal/chart per band = the feed's target %).
export function extractLaborRows(payload) {
  const rd = payload?.rawData || {};
  const rows = Array.isArray(rd.businessDateData) ? rd.businessDateData : [];
  const wtd = storeRowsByNumber(pickSection(rd, WTD_SECTIONS));
  const ptd = storeRowsByNumber(pickSection(rd, PTD_SECTIONS));
  const out = [];
  for (const r of rows) {
    if (!isStoreRow(r)) continue;
    const number = storeNumberOf(r);
    if (!number) continue;
    const w = wtd.get(number);
    const p = ptd.get(number);
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
      // Week to Date band (labor_hours feeds the avg-wage → hours-over calc)
      wtd_net_sales: numOrNull(w?.netSales),
      wtd_labor_cost: numOrNull(w?.laborCost),
      wtd_labor_hours: numOrNull(w?.laborHours),
      wtd_labor_pct: numOrNull(w?.laborPercentage),
      wtd_target_labor_pct: numOrNull(w?.targetLaborPercentage),
      wtd_scheduled_labor_hours: numOrNull(w?.scheduledLaborHours),
      wtd_overtime_hours: numOrNull(w?.overTimeHours),
      wtd_actual_vs_scheduled_hours: numOrNull(w?.actualVsScheduledHours),
      // Period to Date band
      ptd_net_sales: numOrNull(p?.netSales),
      ptd_labor_cost: numOrNull(p?.laborCost),
      ptd_labor_hours: numOrNull(p?.laborHours),
      ptd_labor_pct: numOrNull(p?.laborPercentage),
      ptd_target_labor_pct: numOrNull(p?.targetLaborPercentage),
      ptd_scheduled_labor_hours: numOrNull(p?.scheduledLaborHours),
      ptd_overtime_hours: numOrNull(p?.overTimeHours),
      ptd_actual_vs_scheduled_hours: numOrNull(p?.actualVsScheduledHours),
    });
  }
  return out;
}

// Diagnostic: what the feed actually contains, so a refresh can self-report why
// WTD/PTD may be empty. Returns the rawData section names plus how many
// store-level rows each period section yielded.
export function feedSectionReport(payload) {
  const rd = payload?.rawData || {};
  return {
    feedKeys: Object.keys(rd),
    dayStores: storeRowsByNumber(Array.isArray(rd.businessDateData) ? rd.businessDateData : []).size,
    wtdStores: storeRowsByNumber(pickSection(rd, WTD_SECTIONS)).size,
    ptdStores: storeRowsByNumber(pickSection(rd, PTD_SECTIONS)).size,
  };
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
