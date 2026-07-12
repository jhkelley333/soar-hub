// Backfill labor_v2_daily from the raw KPI snapshots we've stored all along.
// Every kpi_snapshots row keeps the FULL feed payload (hourly, 7AM-2PM CT),
// so fields that capture started landing later (migration 0238: tickets,
// on-time num/den, voids - daily/WTD/PTD) can be recovered for past days by
// re-extracting the stored payload for that business date. Idempotent: the
// upsert rewrites the row from the same source data capture used.

import { extractLaborRows, feedBusinessDate, isPre0238Error } from "./kpiLabor.js";

function addDaysIso(iso, n) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Rewrite one business date's labor rows from the best stored snapshot.
// The feed lags a day, so a business date is usually captured under
// central_date = date + 1; we also try +2 (weekend gaps) and same-day.
export async function backfillLaborDate(supa, businessDate) {
  for (const offset of [1, 2, 0]) {
    const cd = addDaysIso(businessDate, offset);
    const { data: snaps, error } = await supa
      .from("kpi_snapshots")
      .select("central_date, central_hour, payload")
      .eq("central_date", cd)
      .order("central_hour", { ascending: false })
      .limit(2);
    if (error) return { ok: false, date: businessDate, error: error.message };
    for (const snap of snaps || []) {
      const wc = { year: +cd.slice(0, 4), month: +cd.slice(5, 7), day: +cd.slice(8, 10), hour: snap.central_hour };
      const bd = feedBusinessDate(snap.payload, wc);
      if (bd !== businessDate) continue;
      const rows = extractLaborRows(snap.payload)
        .map((r) => ({ ...r, business_date: businessDate, captured_at: new Date().toISOString() }));
      if (!rows.length) continue;
      const { error: upErr } = await supa
        .from("labor_v2_daily")
        .upsert(rows, { onConflict: "store_number,business_date" });
      if (upErr && isPre0238Error(upErr)) return { ok: false, date: businessDate, error: "Migration 0238 not applied yet." };
      if (upErr) return { ok: false, date: businessDate, error: upErr.message };
      return { ok: true, date: businessDate, stores: rows.length, from: `${cd} h${snap.central_hour}` };
    }
  }
  return { ok: false, date: businessDate, error: "no stored snapshot covers this date" };
}

// Backfill a window of recent business dates, newest first, respecting a
// wall-clock budget (Netlify function limits). Returns per-date results and
// the dates it didn't reach so the caller can invoke again to continue.
export async function backfillLaborWindow(supa, { days = 35, budgetMs = 7000 } = {}) {
  const started = Date.now();
  const { data: dateRows, error } = await supa
    .from("labor_v2_daily")
    .select("business_date")
    .order("business_date", { ascending: false })
    .limit(4000);
  if (error) return { error: error.message, status: 500 };
  const dates = [...new Set((dateRows || []).map((r) => r.business_date))].slice(0, Math.max(1, Math.min(120, days)));

  const results = [];
  const remaining = [];
  for (const d of dates) {
    if (Date.now() - started > budgetMs) { remaining.push(d); continue; }
    // Skip dates that already have the 0238 fields (sample one row).
    const { data: probe } = await supa
      .from("labor_v2_daily")
      .select("ptd_tickets, on_time_denominator")
      .eq("business_date", d)
      .not("net_sales", "is", null)
      .limit(1);
    const p = probe?.[0];
    if (p && (p.ptd_tickets != null || p.on_time_denominator != null)) {
      results.push({ ok: true, date: d, skipped: "already filled" });
      continue;
    }
    results.push(await backfillLaborDate(supa, d));
  }
  return {
    filled: results.filter((r) => r.ok && !r.skipped).length,
    already: results.filter((r) => r.skipped).length,
    failed: results.filter((r) => !r.ok),
    remaining,
    results,
  };
}
