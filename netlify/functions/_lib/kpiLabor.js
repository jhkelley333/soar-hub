// Extract per-store labor + sales rows from a KPI feed payload, and resolve the
// feed's business date.

import { isStoreRow, storeNumberOf } from "./kpiOrg.js";

const numOrNull = (v) => (typeof v === "number" && isFinite(v) ? v : null);
// Preserve a feed timestamp/string exactly (naive local wall-clock, may cross
// midnight) — null when empty/missing.
const strOrNull = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

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
      prev_year_net_sales: numOrNull(r.previousYearNetSales),
      // Comparable (same-store) bases — dollars, despite the feed's names (0277).
      net_sales_comp: numOrNull(r.netSalesForComparisonPercentage),
      prev_year_net_sales_comp: numOrNull(r.previousYearNetSalesForComparisonPercentage),
      labor_cost: numOrNull(r.laborCost),
      labor_hours: numOrNull(r.laborHours),
      overtime_hours: numOrNull(r.overTimeHours),
      labor_pct: numOrNull(r.laborPercentage),
      target_labor_pct: numOrNull(r.targetLaborPercentage),
      variance_target: numOrNull(r.varianceTargetValue),
      scheduled_labor_hours: numOrNull(r.scheduledLaborHours),
      actual_vs_scheduled_hours: numOrNull(r.actualVsScheduledHours),
      splh: numOrNull(r.splh),
      // Store operating timestamps for the day (0321): first/last ticket +
      // first clock-in / last clock-out. Naive local times, preserved as-is.
      first_ticket: strOrNull(r.firstTicket),
      last_ticket: strOrNull(r.lastTicket),
      first_clock_in: strOrNull(r.firstClockIn),
      last_clock_out: strOrNull(r.lastClockOut),
      // Ranking-module fields (migration 0238): traffic, on-time, voids.
      tickets: numOrNull(r.tickets),
      prev_year_tickets: numOrNull(r.previousYearTickets),
      on_time_numerator: numOrNull(r.onTimePercentageNumerator),
      on_time_denominator: numOrNull(r.onTimePercentageDenominator),
      void_total: numOrNull(r.voidTotal),
      // Ticket-time (0272): total + quantity; averageTicketTime (0275) is the
      // feed's own per-store average, ticket-weighted for the board's Avg Ticket.
      total_ticket_time: numOrNull(r.totalTicketTime),
      on_time_quantity: numOrNull(r.onTimeQuantity),
      average_ticket_time: numOrNull(r.averageTicketTime),
      // Other Controllable Contribution (0279): cash over/short + paid outs.
      cash_over_short: numOrNull(r.cashOverShort),
      paid_out_dollars: numOrNull(r.paidOutDollars),
      // Order Ahead + Delivery penetration (0296): net sales + denominators so
      // the board recomputes the % from summed bases across a scope.
      order_ahead_net_sales: numOrNull(r.orderAheadNetSales),
      order_ahead_net_sales_denominator: numOrNull(r.orderAheadNetSalesDenominator),
      delivery_net_sales: numOrNull(r.deliveryNetSales),
      delivery_net_sales_denominator: numOrNull(r.deliveryNetSalesDenominator),
      // Week to Date band (labor_hours feeds the avg-wage → hours-over calc)
      wtd_net_sales: numOrNull(w?.netSales),
      wtd_prev_year_net_sales: numOrNull(w?.previousYearNetSales),
      wtd_net_sales_comp: numOrNull(w?.netSalesForComparisonPercentage),
      wtd_prev_year_net_sales_comp: numOrNull(w?.previousYearNetSalesForComparisonPercentage),
      wtd_labor_cost: numOrNull(w?.laborCost),
      wtd_labor_hours: numOrNull(w?.laborHours),
      wtd_labor_pct: numOrNull(w?.laborPercentage),
      wtd_target_labor_pct: numOrNull(w?.targetLaborPercentage),
      wtd_scheduled_labor_hours: numOrNull(w?.scheduledLaborHours),
      wtd_overtime_hours: numOrNull(w?.overTimeHours),
      wtd_actual_vs_scheduled_hours: numOrNull(w?.actualVsScheduledHours),
      wtd_tickets: numOrNull(w?.tickets),
      wtd_prev_year_tickets: numOrNull(w?.previousYearTickets),
      wtd_on_time_numerator: numOrNull(w?.onTimePercentageNumerator),
      wtd_on_time_denominator: numOrNull(w?.onTimePercentageDenominator),
      wtd_void_total: numOrNull(w?.voidTotal),
      wtd_total_ticket_time: numOrNull(w?.totalTicketTime),
      wtd_on_time_quantity: numOrNull(w?.onTimeQuantity),
      wtd_average_ticket_time: numOrNull(w?.averageTicketTime),
      wtd_cash_over_short: numOrNull(w?.cashOverShort),
      wtd_paid_out_dollars: numOrNull(w?.paidOutDollars),
      wtd_order_ahead_net_sales: numOrNull(w?.orderAheadNetSales),
      wtd_order_ahead_net_sales_denominator: numOrNull(w?.orderAheadNetSalesDenominator),
      wtd_delivery_net_sales: numOrNull(w?.deliveryNetSales),
      wtd_delivery_net_sales_denominator: numOrNull(w?.deliveryNetSalesDenominator),
      // Period to Date band
      ptd_net_sales: numOrNull(p?.netSales),
      ptd_prev_year_net_sales: numOrNull(p?.previousYearNetSales),
      ptd_net_sales_comp: numOrNull(p?.netSalesForComparisonPercentage),
      ptd_prev_year_net_sales_comp: numOrNull(p?.previousYearNetSalesForComparisonPercentage),
      ptd_labor_cost: numOrNull(p?.laborCost),
      ptd_labor_hours: numOrNull(p?.laborHours),
      ptd_labor_pct: numOrNull(p?.laborPercentage),
      ptd_target_labor_pct: numOrNull(p?.targetLaborPercentage),
      ptd_scheduled_labor_hours: numOrNull(p?.scheduledLaborHours),
      ptd_overtime_hours: numOrNull(p?.overTimeHours),
      ptd_actual_vs_scheduled_hours: numOrNull(p?.actualVsScheduledHours),
      ptd_tickets: numOrNull(p?.tickets),
      ptd_prev_year_tickets: numOrNull(p?.previousYearTickets),
      ptd_on_time_numerator: numOrNull(p?.onTimePercentageNumerator),
      ptd_on_time_denominator: numOrNull(p?.onTimePercentageDenominator),
      ptd_void_total: numOrNull(p?.voidTotal),
      ptd_total_ticket_time: numOrNull(p?.totalTicketTime),
      ptd_on_time_quantity: numOrNull(p?.onTimeQuantity),
      ptd_average_ticket_time: numOrNull(p?.averageTicketTime),
      ptd_cash_over_short: numOrNull(p?.cashOverShort),
      ptd_paid_out_dollars: numOrNull(p?.paidOutDollars),
      ptd_order_ahead_net_sales: numOrNull(p?.orderAheadNetSales),
      ptd_order_ahead_net_sales_denominator: numOrNull(p?.orderAheadNetSalesDenominator),
      ptd_delivery_net_sales: numOrNull(p?.deliveryNetSales),
      ptd_delivery_net_sales_denominator: numOrNull(p?.deliveryNetSalesDenominator),
    });
  }
  return out;
}

// Columns added by migration 0238 (ranking fields). If a labor_v2_daily upsert
// fails because the migration hasn't run yet, strip these and retry so the
// hourly capture keeps landing the pre-0238 column set instead of erroring.
const RANKING_COLS_0238 = [
  "tickets", "prev_year_tickets", "on_time_numerator", "on_time_denominator", "void_total",
  "wtd_tickets", "wtd_prev_year_tickets", "wtd_on_time_numerator", "wtd_on_time_denominator", "wtd_void_total",
  "ptd_tickets", "ptd_prev_year_tickets", "ptd_on_time_numerator", "ptd_on_time_denominator", "ptd_void_total",
];

export function isPre0238Error(error) {
  return !!error && /column/i.test(String(error.message)) && /tickets|on_time|void_total/.test(String(error.message));
}

export function stripRankingCols(rows) {
  return rows.map((r) => {
    const c = { ...r };
    for (const k of RANKING_COLS_0238) delete c[k];
    return c;
  });
}

// Ticket-time columns added by migration 0272. Same fallback pattern: if the
// upsert fails because 0272 hasn't run, strip just these and retry so the rest
// of the row (including the 0238 fields) still lands.
const TICKET_COLS_0272 = [
  "total_ticket_time", "on_time_quantity",
  "wtd_total_ticket_time", "wtd_on_time_quantity",
  "ptd_total_ticket_time", "ptd_on_time_quantity",
  // average_ticket_time added by 0275 — same strip/retry fallback.
  "average_ticket_time", "wtd_average_ticket_time", "ptd_average_ticket_time",
  // comparable sales bases added by 0277.
  "net_sales_comp", "prev_year_net_sales_comp",
  "wtd_net_sales_comp", "wtd_prev_year_net_sales_comp",
  "ptd_net_sales_comp", "ptd_prev_year_net_sales_comp",
  // cash over/short + paid outs added by 0279.
  "cash_over_short", "paid_out_dollars",
  "wtd_cash_over_short", "wtd_paid_out_dollars",
  "ptd_cash_over_short", "ptd_paid_out_dollars",
];

export function isPre0272Error(error) {
  return !!error && /column/i.test(String(error.message)) && /ticket_time|on_time_quantity|net_sales_comp|cash_over_short|paid_out_dollars/.test(String(error.message));
}

export function stripTicketCols(rows) {
  return rows.map((r) => {
    const c = { ...r };
    for (const k of TICKET_COLS_0272) delete c[k];
    return c;
  });
}

// Order Ahead + Delivery penetration columns added by migration 0296. Same
// strip/retry fallback so capture keeps landing the rest until 0296 runs.
const MIX_COLS_0296 = [
  "order_ahead_net_sales", "order_ahead_net_sales_denominator", "delivery_net_sales", "delivery_net_sales_denominator",
  "wtd_order_ahead_net_sales", "wtd_order_ahead_net_sales_denominator", "wtd_delivery_net_sales", "wtd_delivery_net_sales_denominator",
  "ptd_order_ahead_net_sales", "ptd_order_ahead_net_sales_denominator", "ptd_delivery_net_sales", "ptd_delivery_net_sales_denominator",
];

export function isPreMixError(error) {
  return !!error && /column/i.test(String(error.message)) && /order_ahead_net_sales|delivery_net_sales/.test(String(error.message));
}

export function stripMixCols(rows) {
  return rows.map((r) => {
    const c = { ...r };
    for (const k of MIX_COLS_0296) delete c[k];
    return c;
  });
}

// Store-hours timestamp columns added by migration 0321. Same strip/retry
// fallback so capture keeps landing the rest of the row until 0321 runs.
const HOURS_COLS_0321 = ["first_ticket", "last_ticket", "first_clock_in", "last_clock_out"];

export function isPreHoursError(error) {
  return !!error && /column/i.test(String(error.message)) && /first_ticket|last_ticket|first_clock_in|last_clock_out/.test(String(error.message));
}

export function stripHoursCols(rows) {
  return rows.map((r) => {
    const c = { ...r };
    for (const k of HOURS_COLS_0321) delete c[k];
    return c;
  });
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
