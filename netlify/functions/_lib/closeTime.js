// Shared Close-Time Watch logic — the comparison of a store's last clock-out
// (labor_v2_daily.last_clock_out) against its scheduled Hours-of-Operation
// close (store_hours + store_special_hours). Used by the close-compliance page
// function and the daily Close-Time report so both flag the same way.

import { resolveOrg } from "./kpiOrg.js";

// A clock-out within GRACE_MIN before close is "borderline" (amber); earlier
// than that is flagged (red). At/after close is on-time (green).
export const GRACE_MIN = 10;

export const isoAddDays = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
// Mon=0 .. Sun=6 for an ISO date (matches store_hours.day_of_week).
export const dow = (iso) => { const [y, m, d] = iso.split("-").map(Number); return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; };
export const hhmm = (t) => (t ? String(t).slice(0, 5) : null); // "HH:MM:SS" -> "HH:MM" (time values)
export const tsHHMM = (s) => { const m = /[ T](\d{2}:\d{2})/.exec(String(s || "")); return m ? m[1] : null; }; // HH:MM out of a timestamp
export const tmin = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "")); return m ? (+m[1]) * 60 + (+m[2]) : null; };
export function tsMin(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s || ""));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000 : null;
}
export const dayMin = (iso, minPastMidnight, dayOffset = 0) => tsMin(isoAddDays(iso, dayOffset) + "T00:00") + minPastMidnight;

// The scheduled close for one store on one business date. A dated special-hours
// override wins over the standard weekday row. Overnight closes (close <= open,
// or an early-AM close with no open on file) land on the next calendar day.
export function scheduledClose(bizDate, weekday, special) {
  const src = special || weekday;
  if (!src) return { hasHours: false };
  if (src.is_closed) return { hasHours: true, closed: true };
  const closeM = tmin(src.close_time);
  if (closeM == null) return { hasHours: true, closed: false, closeAbs: null };
  const openM = tmin(src.open_time);
  const overnight = (openM != null && closeM <= openM) || (openM == null && closeM < 360);
  return {
    hasHours: true, closed: false,
    closeAbs: dayMin(bizDate, closeM, overnight ? 1 : 0),
    closeLabel: hhmm(src.close_time), overnight, isSpecial: !!special,
  };
}

export const classify = (delta) => (delta <= -GRACE_MIN ? "flag" : delta < 0 ? "warn" : "good");

// Evaluate every store's last clock-out for ONE business date against its
// scheduled close. Returns per-store rows with org attribution, for the daily
// report and (via the page's own loop) any single day. Stores with no captured
// clock-out, no hours on file, or a dark day are omitted.
export async function evaluateCloseDay(supa, businessDate, { storeIds = null } = {}) {
  const { data: labor } = await supa.from("labor_v2_daily")
    .select("store_number, last_clock_out")
    .eq("business_date", businessDate).not("last_clock_out", "is", null);
  const numbers = [...new Set((labor || []).map((r) => String(r.store_number)))];
  if (!numbers.length) return { rows: [], evaluated: 0 };

  const { data: storeRows } = await supa.from("stores").select("id, number, name").in("number", numbers);
  const idByNum = new Map((storeRows || []).map((s) => [String(s.number), s.id]));
  const nameByNum = new Map((storeRows || []).map((s) => [String(s.number), s.name]));
  const ids = [...idByNum.values()];
  const org = await resolveOrg(supa, numbers);

  const [{ data: hoursRows }, { data: specialRows }] = await Promise.all([
    ids.length ? supa.from("store_hours").select("store_id, day_of_week, is_closed, open_time, close_time").in("store_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? supa.from("store_special_hours").select("store_id, special_date, is_closed, open_time, close_time").eq("special_date", businessDate).in("store_id", ids) : Promise.resolve({ data: [] }),
  ]);
  const weekly = new Map();
  for (const h of hoursRows || []) { const m = weekly.get(h.store_id) || {}; m[h.day_of_week] = h; weekly.set(h.store_id, m); }
  const special = new Map();
  for (const s of specialRows || []) special.set(s.store_id, s);

  const scopeSet = storeIds ? new Set(storeIds) : null;
  const wd = dow(businessDate);
  const rows = [];
  let evaluated = 0;
  for (const r of labor || []) {
    const num = String(r.store_number);
    const id = idByNum.get(num);
    if (!id) continue;
    if (scopeSet && !scopeSet.has(id)) continue;
    const sc = scheduledClose(businessDate, (weekly.get(id) || {})[wd], special.get(id) || null);
    if (!sc.hasHours || sc.closed || sc.closeAbs == null) continue;
    const outAbs = tsMin(r.last_clock_out);
    if (outAbs == null) continue;
    const delta = Math.round(outAbs - sc.closeAbs);
    const o = org.get(num) || {};
    evaluated++;
    rows.push({
      store_id: id, store_number: num, name: nameByNum.get(num) || o.store || num,
      doName: o.doName || null, sdoName: o.sdoName || null, rvpName: o.rvpName || null, region: o.region || null,
      close: sc.closeLabel, out: tsHHMM(r.last_clock_out), delta, status: classify(delta), overnight: sc.overnight,
    });
  }
  return { rows, evaluated };
}
