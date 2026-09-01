// close-compliance — "Close-Time Watch". Compares each store's last clock-out
// (labor_v2_daily.last_clock_out, migration 0321) against its scheduled
// Hours-of-Operation close (store_hours + store_special_hours, 0281) and flags
// stores that clocked out BEFORE close — a signal the store may have closed
// early or the closer left before lockup. Daily / weekly / monthly, scoped to
// the caller's org, grouped by DO.
//
//   GET ?action=summary&view=daily|weekly|monthly[&date=YYYY-MM-DD]
//
// Admin/VP/COO org-wide; SDO/RVP see their scope (same VIEW_ROLES as Hours of
// Operation). Service-role only; all reads mediated here.

import { createClient } from "@supabase/supabase-js";
import { resolveOrg } from "./_lib/kpiOrg.js";
import { fiscalForDate } from "./_lib/fiscal.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VIEW_ROLES = new Set(["admin", "vp", "coo", "sdo", "rvp"]);
const ORG_WIDE = new Set(["admin", "vp", "coo"]);
// A clock-out within GRACE_MIN before close is "borderline" (amber); earlier
// than that is flagged (red). At/after close is on-time (green).
const GRACE_MIN = 10;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function respond(code, payload) {
  return { statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}
async function sessionUser(supa, event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const { data: { user } = {} } = await supa.auth.getUser(header.slice(7).trim());
  if (!user) return null;
  const { data: p } = await supa.from("profiles").select("id, role, is_active").eq("id", user.id).maybeSingle();
  return p && p.is_active ? { id: p.id, role: String(p.role || "").toLowerCase() } : null;
}
async function visibleIds(supa, user) {
  if (ORG_WIDE.has(user.role)) return null; // org-wide, no restriction
  const { data } = await supa.rpc("user_visible_stores", { uid: user.id });
  return new Set((data ?? []).map((v) => (typeof v === "string" ? v : v?.user_visible_stores ?? null)).filter(Boolean));
}

// ── date/time helpers — everything naive & store-local (no timezone) ──
const isoAddDays = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
// Mon=0 .. Sun=6 for an ISO date (matches store_hours.day_of_week).
const dow = (iso) => { const [y, m, d] = iso.split("-").map(Number); return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; };
const hhmm = (t) => (t ? String(t).slice(0, 5) : null); // "HH:MM:SS" -> "HH:MM"
// "HH:MM[:SS]" -> minutes past midnight, or null.
const tmin = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "")); return m ? (+m[1]) * 60 + (+m[2]) : null; };
// naive timestamp "YYYY-MM-DDTHH:MM[:SS]" -> absolute minutes (UTC epoch as a
// tz-neutral number line — both operands use the same basis so the delta is
// exact regardless of real timezone).
function tsMin(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s || ""));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000 : null;
}
// absolute minutes for (business date + minutes-past-midnight), shifted dayOffset days.
const dayMin = (iso, minPastMidnight, dayOffset = 0) => tsMin(isoAddDays(iso, dayOffset) + "T00:00") + minPastMidnight;

// The scheduled close for one store on one business date. A dated special-hours
// override wins over the standard weekday row. Overnight closes (close <= open,
// or an early-AM close with no open on file) land on the next calendar day.
function scheduledClose(bizDate, weekday, special) {
  const src = special || weekday; // override wins
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

const classify = (delta) => (delta <= -GRACE_MIN ? "flag" : delta < 0 ? "warn" : "good");

async function summary(supa, user, params) {
  const view = ["daily", "weekly", "monthly"].includes(params.view) ? params.view : "daily";

  // Anchor business date: the requested one, else the latest captured.
  let anchor = /^\d{4}-\d{2}-\d{2}$/.test(params.date || "") ? params.date : null;
  if (!anchor) {
    const { data } = await supa.from("labor_v2_daily").select("business_date").order("business_date", { ascending: false }).limit(1);
    anchor = data?.[0]?.business_date || null;
  }
  if (!anchor) return { view, date: null, groups: [], totals: {}, grace_min: GRACE_MIN, message: "No labor data captured yet." };

  const fi = fiscalForDate(anchor);
  let start = anchor, end = anchor;
  if (view === "weekly") { start = fi?.weekStart ?? anchor; end = fi?.weekEnd ?? anchor; }
  else if (view === "monthly") { start = fi?.periodStart ?? anchor; end = fi?.periodEnd ?? anchor; }
  if (end > anchor) end = anchor; // never evaluate days that haven't happened yet

  const scope = await visibleIds(supa, user);

  const { data: labor } = await supa.from("labor_v2_daily")
    .select("store_number, business_date, last_clock_out")
    .gte("business_date", start).lte("business_date", end)
    .not("last_clock_out", "is", null);
  const numbers = [...new Set((labor || []).map((r) => String(r.store_number)))];
  if (!numbers.length) return { view, date: anchor, range: { start, end }, period: fi?.period, week: fi?.weekInPeriod, groups: [], totals: {}, grace_min: GRACE_MIN };

  const { data: storeRows } = await supa.from("stores").select("id, number, name").in("number", numbers);
  const idByNum = new Map((storeRows || []).map((s) => [String(s.number), s.id]));
  const nameByNum = new Map((storeRows || []).map((s) => [String(s.number), s.name]));
  const storeIds = [...idByNum.values()];
  const org = await resolveOrg(supa, numbers);

  const [{ data: hoursRows }, { data: specialRows }] = await Promise.all([
    storeIds.length ? supa.from("store_hours").select("store_id, day_of_week, is_closed, open_time, close_time").in("store_id", storeIds) : Promise.resolve({ data: [] }),
    storeIds.length ? supa.from("store_special_hours").select("store_id, special_date, is_closed, open_time, close_time").in("store_id", storeIds).gte("special_date", start).lte("special_date", end) : Promise.resolve({ data: [] }),
  ]);
  const weekly = new Map();
  for (const h of hoursRows || []) { const m = weekly.get(h.store_id) || {}; m[h.day_of_week] = h; weekly.set(h.store_id, m); }
  const special = new Map();
  for (const s of specialRows || []) { const m = special.get(s.store_id) || {}; m[s.special_date] = s; special.set(s.store_id, m); }

  // Evaluate each captured clock-out against that day's scheduled close.
  const perStore = new Map();
  let noHours = 0;
  for (const r of labor || []) {
    const num = String(r.store_number);
    const id = idByNum.get(num);
    if (!id) continue;
    if (scope != null && !scope.has(id)) continue; // outside caller's org scope
    const sc = scheduledClose(r.business_date, (weekly.get(id) || {})[dow(r.business_date)], (special.get(id) || {})[r.business_date]);
    if (!sc.hasHours || sc.closed || sc.closeAbs == null) { if (!sc.hasHours) noHours++; continue; }
    const outAbs = tsMin(r.last_clock_out);
    if (outAbs == null) continue;
    const delta = Math.round(outAbs - sc.closeAbs); // minutes; negative = before close
    const rec = perStore.get(num) || {
      number: num,
      name: nameByNum.get(num) || org.get(num)?.store || num,
      do: org.get(num)?.doName || (org.get(num)?.district ? `${org.get(num).district} (no DO)` : "Unassigned"),
      days: [],
    };
    rec.days.push({ date: r.business_date, status: classify(delta), delta, close: sc.closeLabel, out: hhmm(r.last_clock_out), overnight: sc.overnight, special: sc.isSpecial });
    perStore.set(num, rec);
  }

  // Shape per-store rows for the view, then group by DO.
  const stores = [...perStore.values()].map((s) => {
    s.days.sort((a, b) => (a.date < b.date ? -1 : 1));
    const evalDays = s.days.length;
    const early = s.days.filter((d) => d.status === "flag").length;
    const borderline = s.days.filter((d) => d.status === "warn").length;
    const worst = s.days.reduce((w, d) => (d.delta < (w?.delta ?? Infinity) ? d : w), null);
    if (view === "daily") {
      const d = s.days[s.days.length - 1]; // the anchor day
      return { number: s.number, name: s.name, do: s.do, status: d.status, delta: d.delta, close: d.close, out: d.out, overnight: d.overnight, special: d.special };
    }
    return {
      number: s.number, name: s.name, do: s.do,
      eval_days: evalDays, early_days: early, borderline_days: borderline,
      worst_delta: worst ? worst.delta : null,
      rate: evalDays ? early / evalDays : 0,
      days: s.days.map((d) => ({ date: d.date, status: d.status, delta: d.delta })),
    };
  });

  // Group by DO.
  const byDo = new Map();
  for (const s of stores) { const g = byDo.get(s.do) || []; g.push(s); byDo.set(s.do, g); }
  const groups = [...byDo.entries()].map(([name, list]) => {
    list.sort((a, b) => {
      if (view === "daily") return (a.delta ?? 0) - (b.delta ?? 0); // most-early first
      return (b.early_days - a.early_days) || (a.worst_delta ?? 0) - (b.worst_delta ?? 0);
    });
    const flagged = view === "daily" ? list.filter((s) => s.status === "flag").length : list.filter((s) => s.early_days > 0).length;
    return { do: name, stores: list, flagged, count: list.length };
  }).sort((a, b) => (b.flagged - a.flagged) || (a.do > b.do ? 1 : -1));

  // View-specific totals for the KPI row.
  let totals;
  if (view === "daily") {
    const flag = stores.filter((s) => s.status === "flag");
    const good = stores.filter((s) => s.status === "good").length;
    const avgEarly = flag.length ? Math.round(flag.reduce((a, s) => a - s.delta, 0) / flag.length) : 0;
    const worst = flag.slice().sort((a, b) => a.delta - b.delta)[0] || null;
    totals = {
      evaluated: stores.length, flagged: flag.length, borderline: stores.filter((s) => s.status === "warn").length,
      on_time: good, avg_early_min: avgEarly,
      worst: worst ? { number: worst.number, name: worst.name, delta: worst.delta } : null,
      on_time_pct: stores.length ? Math.round(good / stores.length * 100) : null,
    };
  } else {
    const flaggedStores = stores.filter((s) => s.early_days > 0);
    const events = stores.reduce((a, s) => a + s.early_days, 0);
    const totalEval = stores.reduce((a, s) => a + s.eval_days, 0);
    const worst = stores.slice().sort((a, b) => (b.early_days - a.early_days) || (a.worst_delta ?? 0) - (b.worst_delta ?? 0))[0] || null;
    totals = {
      evaluated: stores.length, stores_flagged: flaggedStores.length,
      repeat_offenders: stores.filter((s) => s.early_days >= 3).length,
      events, worst: worst ? { number: worst.number, name: worst.name, early_days: worst.early_days, eval_days: worst.eval_days } : null,
      on_time_pct: totalEval ? Math.round((1 - events / totalEval) * 100) : null,
    };
  }

  return {
    view, date: anchor, range: { start, end },
    period: fi?.period ?? null, week: fi?.weekInPeriod ?? null,
    grace_min: GRACE_MIN, no_hours_days: noHours, groups, totals,
  };
}

export const handler = async (event) => {
  let supa;
  try { supa = admin(); } catch (e) { return respond(500, { error: e.message }); }
  const user = await sessionUser(supa, event);
  if (!user) return respond(401, { error: "Not signed in." });
  if (!VIEW_ROLES.has(user.role)) return respond(403, { error: "Not authorized." });

  const params = event.queryStringParameters || {};
  const action = params.action || "summary";
  try {
    if (action === "summary") return respond(200, await summary(supa, user, params));
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    console.log(`[close-compliance] ${action} failed: ${e?.message || e}`);
    return respond(500, { error: e?.message || "Request failed" });
  }
};
