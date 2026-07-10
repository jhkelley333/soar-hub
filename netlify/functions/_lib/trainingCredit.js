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
function ptoCreditDates(req, rate) {
  const picked = Array.isArray(req.vacation_days)
    ? req.vacation_days.filter((d) => d && d.date).map((d) => String(d.date).slice(0, 10))
    : [];
  if (picked.length) return picked.map((date) => ({ date, amount: rate, hours: 0 }));
  const startMs = parseIso(req.pto_start_date);
  if (startMs == null) return [];
  const endMs = parseIso(req.pto_end_date) ?? startMs;
  const n = Math.min(31, Math.max(0, Math.round(numv(req.days_used))));
  const out = [];
  for (let i = 0, ms = startMs; i < n && ms <= endMs; i++, ms += DAY) {
    out.push({ date: isoOf(ms), amount: rate, hours: 0 });
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
  for (const req of data || []) {
    const sn = String(req.store_number);
    const arr = map.get(sn) || [];
    for (const c of ptoCreditDates(req, rate)) arr.push(c);
    if (arr.length) map.set(sn, arr);
  }
  return map;
}

// All labor credits for the given stores: training + GM PTO, one merged map
// for applyCreditsToRows.
export async function loadLaborCredits(supa, storeNumbers) {
  const [tc, pto] = await Promise.all([
    loadTrainingCreditDates(supa, storeNumbers),
    loadGmPtoCreditDates(supa, storeNumbers),
  ]);
  for (const [sn, arr] of pto) {
    const cur = tc.get(sn) || [];
    tc.set(sn, cur.concat(arr));
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
