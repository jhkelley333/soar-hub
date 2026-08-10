// Training credit → labor adjustment for Labor v2. Approved training-credit
// requests (training_credit_requests) credit a store's labor: the training
// hours and dollars shouldn't count against the chart. We resolve each request's
// weekday training days to calendar dates, then subtract the $ and hours from
// each labor row's Daily / WTD / PTD bands whose window covers that date.

import { fiscalForDate } from "./fiscal.js";

const DAY = 86400000;
const WD = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
const numv = (v) => (v == null || isNaN(Number(v)) ? 0 : Number(v));

function parseIso(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
}
function isoOf(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// Blended wage per store from recent labor (~35 days): labor_cost / labor_hours.
// Used to convert a dollar credit into the hours it relieves on the Hours Over
// Chart, so every $ credit reduces both labor % and hours-over. Fallback $13/hr.
const CREDIT_FALLBACK_WAGE = 13;
async function blendedWageByStore(supa, storeSet) {
  const out = new Map();
  const stores = [...storeSet].map(String);
  if (!stores.length) return out;
  const since = isoOf(Date.now() - 35 * DAY);
  const { data } = await supa.from("labor_v2_daily")
    .select("store_number, labor_cost, labor_hours")
    .in("store_number", stores).gte("business_date", since);
  const agg = new Map();
  for (const r of data || []) {
    const sn = String(r.store_number);
    const a = agg.get(sn) || { cost: 0, hours: 0 };
    a.cost += numv(r.labor_cost); a.hours += numv(r.labor_hours);
    agg.set(sn, a);
  }
  for (const sn of stores) {
    const a = agg.get(sn);
    out.set(sn, a && a.hours > 0 ? a.cost / a.hours : CREDIT_FALLBACK_WAGE);
  }
  return out;
}

// Resolve a request's weekday training days to calendar dates: each picked
// weekday → its first occurrence on/after the start date. Returns [{date,$,hrs}].
function creditDates(req) {
  const startMs = parseIso(req.start_date);
  if (startMs == null) return [];
  const days = Array.isArray(req.training_days) ? req.training_days : [];
  const out = [];
  for (const d of days) {
    const target = WD[d?.day];
    if (target == null) continue;
    let ms = startMs;
    for (let i = 0; i < 7 && new Date(ms).getUTCDay() !== target; i++) ms += DAY;
    out.push({ date: isoOf(ms), amount: numv(d.amount), hours: numv(d.hours) });
  }
  return out;
}

// Approved credits for the given stores → Map<store_number, [{date,amount,hours}]>.
export async function loadTrainingCreditDates(supa, storeNumbers) {
  const map = new Map();
  if (!storeNumbers.length) return map;
  const { data } = await supa
    .from("training_credit_requests")
    .select("store_number, start_date, training_days, status, approved_at")
    .in("store_number", storeNumbers)
    .not("approved_at", "is", null)
    .neq("status", "Withdrawn");
  for (const req of data || []) {
    const sn = String(req.store_number);
    const arr = map.get(sn) || [];
    for (const c of creditDates(req)) arr.push(c);
    if (arr.length) map.set(sn, arr);
  }
  return map;
}

// ── GM PTO labor credit ──────────────────────────────────────────────────────
// A GM on approved PTO credits the store's labor chart the same way training
// does: a fixed dollar amount per selected PTO day (default 176.00 = 880 for
// a 5-day week), rate adjustable in ea_settings.gm_pto_daily_credit.
const GM_PTO_DEFAULT_DAILY = 176;

async function gmPtoDailyRate(supa) {
  try {
    const { data } = await supa.from("ea_settings")
      .select("value").eq("key", "gm_pto_daily_credit").maybeSingle();
    const amt = Number(data?.value?.amount);
    return isFinite(amt) && amt > 0 ? amt : GM_PTO_DEFAULT_DAILY;
  } catch { return GM_PTO_DEFAULT_DAILY; }
}

// A request's PTO days → [{date, amount, hours}]. New requests carry explicit
// vacation_days [{date}]; legacy GM rows (start/end + days_used only) credit
// consecutive days from the start date, days_used long, capped at the end.
function ptoCreditDates(req, rate, wage) {
  const hrs = wage > 0 ? rate / wage : 0; // $ credit also relieves the Hours Over Chart
  const picked = Array.isArray(req.vacation_days)
    ? req.vacation_days.filter((d) => d && d.date).map((d) => String(d.date).slice(0, 10))
    : [];
  if (picked.length) return picked.map((date) => ({ date, amount: rate, hours: hrs }));
  const startMs = parseIso(req.pto_start_date);
  if (startMs == null) return [];
  const endMs = parseIso(req.pto_end_date) ?? startMs;
  const n = Math.min(31, Math.max(0, Math.round(numv(req.days_used))));
  const out = [];
  for (let i = 0, ms = startMs; i < n && ms <= endMs; i++, ms += DAY) {
    out.push({ date: isoOf(ms), amount: rate, hours: hrs });
  }
  return out;
}

export async function loadGmPtoCreditDates(supa, storeNumbers) {
  const map = new Map();
  if (!storeNumbers.length) return map;
  const rate = await gmPtoDailyRate(supa);
  const { data } = await supa
    .from("pto_requests")
    .select("store_number, position, pto_start_date, pto_end_date, days_used, vacation_days, status, approved_at")
    .in("store_number", storeNumbers)
    .eq("position", "GM")
    .not("approved_at", "is", null)
    .neq("status", "Withdrawn");
  const reqs = data || [];
  if (!reqs.length) return map;
  const wages = await blendedWageByStore(supa, new Set(reqs.map((r) => String(r.store_number))));
  for (const req of reqs) {
    const sn = String(req.store_number);
    const arr = map.get(sn) || [];
    for (const c of ptoCreditDates(req, rate, wages.get(sn) || CREDIT_FALLBACK_WAGE)) arr.push(c);
    if (arr.length) map.set(sn, arr);
  }
  return map;
}

// ── No-GM labor credit ───────────────────────────────────────────────────────
// A store with no GM (LOA / open seat / GM in training) credits its labor
// chart a fixed weekly amount for as long as the tag is active. Rate lives in
// ea_settings.no_gm_weekly_credit (default 880.00/week), spread evenly across
// all 7 days so a full week nets exactly the weekly amount.
const NO_GM_DEFAULT_WEEKLY = 880;

async function noGmWeeklyRate(supa) {
  try {
    const { data } = await supa.from("ea_settings")
      .select("value").eq("key", "no_gm_weekly_credit").maybeSingle();
    const amt = Number(data?.value?.amount);
    return isFinite(amt) && amt > 0 ? amt : NO_GM_DEFAULT_WEEKLY;
  } catch { return NO_GM_DEFAULT_WEEKLY; }
}

export async function loadNoGmCreditDates(supa, storeNumbers) {
  const map = new Map();
  if (!storeNumbers.length) return map;
  const weekly = await noGmWeeklyRate(supa);
  const daily = weekly / 7;
  const { data } = await supa
    .from("no_gm_credits")
    .select("store_number, start_date, end_date")
    .in("store_number", storeNumbers);
  const recs = data || [];
  if (!recs.length) return map;
  const wages = await blendedWageByStore(supa, new Set(recs.map((r) => String(r.store_number))));
  const todayMs = Date.now();
  for (const rec of recs) {
    const startMs = parseIso(rec.start_date);
    if (startMs == null) continue;
    // Open-ended records credit through today; dates past the queried rows
    // never match anyway (applyCreditsToRows filters per row). Safety-capped.
    const endMs = Math.min(parseIso(rec.end_date) ?? todayMs, todayMs);
    const sn = String(rec.store_number);
    const wage = wages.get(sn) || CREDIT_FALLBACK_WAGE;
    const dailyHours = wage > 0 ? daily / wage : 0; // $ credit also relieves Hours Over
    const arr = map.get(sn) || [];
    for (let ms = startMs, i = 0; ms <= endMs && i < 400; ms += DAY, i++) {
      arr.push({ date: isoOf(ms), amount: daily, hours: dailyHours });
    }
    if (arr.length) map.set(sn, arr);
  }
  return map;
}

// ── GM support-hours labor credit ────────────────────────────────────────────
// A GM who supports other stores gets N labor hours/week credited to their own
// store (default 20). The hours convert to dollars using the store's own blended
// wage (recent labor_cost / labor_hours), so both cost and hours drop — the same
// units the chart is measured in. Falls back to ea_settings.gm_support_default_wage
// when a store has no recent labor to blend from.
const GM_SUPPORT_DEFAULT_WEEKLY_HOURS = 20;
const GM_SUPPORT_DEFAULT_WAGE = 13;

async function gmSupportDefaultWage(supa) {
  try {
    const { data } = await supa.from("ea_settings").select("value").eq("key", "gm_support_default_wage").maybeSingle();
    const amt = Number(data?.value?.amount);
    return isFinite(amt) && amt > 0 ? amt : GM_SUPPORT_DEFAULT_WAGE;
  } catch { return GM_SUPPORT_DEFAULT_WAGE; }
}

export async function loadGmSupportCreditDates(supa, storeNumbers) {
  const map = new Map();
  if (!storeNumbers.length) return map;
  const { data: tags } = await supa
    .from("gm_support_hours_credits")
    .select("store_number, weekly_hours, buffer_pct, start_date, end_date")
    .in("store_number", storeNumbers);
  if (!tags || !tags.length) return map;

  // Recent labor per tagged store (last ~35 days): blended wage for hours-based
  // tags, plus average daily cost/hours for % buffer tags.
  const tagStores = [...new Set(tags.map((t) => String(t.store_number)))];
  const since = isoOf(Date.now() - 35 * DAY);
  const { data: rows } = await supa
    .from("labor_v2_daily")
    .select("store_number, labor_cost, labor_hours, net_sales")
    .in("store_number", tagStores)
    .gte("business_date", since);
  const agg = new Map();
  for (const r of rows || []) {
    const sn = String(r.store_number);
    const a = agg.get(sn) || { cost: 0, hours: 0, sales: 0, days: 0 };
    a.cost += Number(r.labor_cost) || 0;
    a.hours += Number(r.labor_hours) || 0;
    a.sales += Number(r.net_sales) || 0;
    a.days += 1;
    agg.set(sn, a);
  }
  const fallbackWage = await gmSupportDefaultWage(supa);
  const todayMs = Date.now();
  for (const t of tags) {
    const startMs = parseIso(t.start_date);
    if (startMs == null) continue;
    const endMs = Math.min(parseIso(t.end_date) ?? todayMs, todayMs);
    const sn = String(t.store_number);
    const a = agg.get(sn);
    const bufferPct = Number(t.buffer_pct);
    let dailyHours, dailyAmount;
    if (isFinite(bufferPct) && bufferPct > 0) {
      // % buffer off SALES: credit buffer_pct of the store's typical daily sales
      // (from recent data), reducing labor cost by that $ and hours by the
      // matching amount at the store's blended wage. Falls back to the hours
      // default only if the store has no recent sales to size the % against.
      if (a && a.days > 0 && a.sales > 0) {
        const wage = a.hours > 0 ? a.cost / a.hours : fallbackWage;
        dailyAmount = (bufferPct / 100) * (a.sales / a.days);
        dailyHours = wage > 0 ? dailyAmount / wage : 0;
      } else {
        dailyHours = GM_SUPPORT_DEFAULT_WEEKLY_HOURS / 7;
        dailyAmount = dailyHours * fallbackWage;
      }
    } else {
      const wage = a && a.hours > 0 ? a.cost / a.hours : fallbackWage;
      const weeklyHours = Number(t.weekly_hours) > 0 ? Number(t.weekly_hours) : GM_SUPPORT_DEFAULT_WEEKLY_HOURS;
      dailyHours = weeklyHours / 7;
      dailyAmount = dailyHours * wage;
    }
    const arr = map.get(sn) || [];
    for (let ms = startMs, i = 0; ms <= endMs && i < 400; ms += DAY, i++) {
      arr.push({ date: isoOf(ms), amount: dailyAmount, hours: dailyHours });
    }
    if (arr.length) map.set(sn, arr);
  }
  return map;
}

// ── Corporate training-class labor credit ────────────────────────────────────
// A corporate training class credits each attendee's store a fixed dollar amount
// per class day (default 176.00/day, per-batch adjustable). Batches are uploaded
// from a CSV of stores, then applied to specific calendar dates. `stores` is
// [{store_number, count}] so a store with N attendees is credited N x rate/day.
// The $ credit ALSO relieves the Hours Over Chart: it converts to hours at the
// store's recent blended wage (cost/hours), so both labor % and hours-over drop
// — the same $<->hours bridge the GM support-hours credit uses.
export const CORP_TRAINING_DEFAULT_DAILY = 176;

export async function corpTrainingDailyRate(supa) {
  try {
    const { data } = await supa.from("ea_settings")
      .select("value").eq("key", "corp_training_daily_credit").maybeSingle();
    const amt = Number(data?.value?.amount);
    return isFinite(amt) && amt > 0 ? amt : CORP_TRAINING_DEFAULT_DAILY;
  } catch { return CORP_TRAINING_DEFAULT_DAILY; }
}

export async function loadCorporateTrainingCreditDates(supa, storeNumbers) {
  const map = new Map();
  if (!storeNumbers.length) return map;
  const want = new Set(storeNumbers.map(String));
  const { data } = await supa
    .from("corporate_training_credits")
    .select("daily_amount, dates, stores");
  const batches = data || [];
  if (!batches.length) return map;

  // Blended wage per store, so the $ credit also reduces hours = $ / wage. Only
  // look up stores that actually appear in a batch.
  const relevant = new Set();
  for (const b of batches) {
    for (const s of Array.isArray(b.stores) ? b.stores : []) {
      const sn = String(s?.store_number ?? s?.number ?? "").trim();
      if (want.has(sn)) relevant.add(sn);
    }
  }
  const wageOf = await blendedWageByStore(supa, relevant);

  for (const batch of batches) {
    const amt = numv(batch.daily_amount) > 0 ? numv(batch.daily_amount) : CORP_TRAINING_DEFAULT_DAILY;
    const dates = Array.isArray(batch.dates) ? batch.dates : [];
    const stores = Array.isArray(batch.stores) ? batch.stores : [];
    for (const s of stores) {
      const sn = String(s?.store_number ?? s?.number ?? "").trim();
      if (!want.has(sn)) continue;
      const count = Math.max(1, Math.round(numv(s?.count) || 1));
      const dailyAmt = amt * count;
      const wage = wageOf.get(sn) || CREDIT_FALLBACK_WAGE;
      const dailyHours = wage > 0 ? dailyAmt / wage : 0;
      const arr = map.get(sn) || [];
      for (const d of dates) arr.push({ date: String(d).slice(0, 10), amount: dailyAmt, hours: dailyHours });
      if (arr.length) map.set(sn, arr);
    }
  }
  return map;
}

// All labor credits for the given stores: training + GM PTO + no-GM + GM
// support-hours + corporate training class, one merged map for applyCreditsToRows.
export async function loadLaborCredits(supa, storeNumbers) {
  const [tc, pto, noGm, gmSup, corp] = await Promise.all([
    loadTrainingCreditDates(supa, storeNumbers),
    loadGmPtoCreditDates(supa, storeNumbers),
    loadNoGmCreditDates(supa, storeNumbers),
    loadGmSupportCreditDates(supa, storeNumbers),
    loadCorporateTrainingCreditDates(supa, storeNumbers),
  ]);
  for (const extra of [pto, noGm, gmSup, corp]) {
    for (const [sn, arr] of extra) {
      const cur = tc.get(sn) || [];
      tc.set(sn, cur.concat(arr));
    }
  }
  return tc;
}

// Subtract each store's credit from its labor rows, per band, using each row's
// own business_date to define the Daily / WTD / PTD windows. Mutates the rows
// (cost, hours, recomputed labor_pct) and stamps r._tc for display.
export function applyCreditsToRows(rows, creditMap) {
  for (const r of rows) {
    const credits = creditMap.get(String(r.store_number));
    if (!credits || !credits.length) continue;
    const bd = String(r.business_date);
    const fi = fiscalForDate(bd);
    const weekStart = fi?.weekStart ?? bd;
    const periodStart = fi?.periodStart ?? bd;
    const tc = { day: { amt: 0, hrs: 0 }, wtd: { amt: 0, hrs: 0 }, ptd: { amt: 0, hrs: 0 } };
    for (const c of credits) {
      if (c.date < periodStart || c.date > bd) continue;
      tc.ptd.amt += c.amount; tc.ptd.hrs += c.hours;
      if (c.date >= weekStart) { tc.wtd.amt += c.amount; tc.wtd.hrs += c.hours; }
      if (c.date === bd) { tc.day.amt += c.amount; tc.day.hrs += c.hours; }
    }
    apply(r, "", tc.day);
    apply(r, "wtd_", tc.wtd);
    apply(r, "ptd_", tc.ptd);
    r._tc = tc;
  }
}

function apply(r, prefix, credit) {
  if (!credit.amt && !credit.hrs) return;
  const origCost = numv(r[prefix + "labor_cost"]);
  const sales = numv(r[prefix + "net_sales"]);
  // Remember the pre-credit labor % (fraction) for display, computed the same
  // way as the post-credit value (cost ÷ sales) so it's an apples-to-apples "was".
  const key = prefix === "" ? "day" : prefix === "wtd_" ? "wtd" : "ptd";
  r._tcPre = r._tcPre || {};
  r._tcPre[key] = sales ? origCost / sales : (r[prefix + "labor_pct"] ?? null);
  const cost = Math.max(0, origCost - credit.amt);
  const hours = Math.max(0, numv(r[prefix + "labor_hours"]) - credit.hrs);
  r[prefix + "labor_cost"] = cost;
  r[prefix + "labor_hours"] = hours;
  if (sales) r[prefix + "labor_pct"] = cost / sales; // keep the stored % in sync (GM view reads it)
}
