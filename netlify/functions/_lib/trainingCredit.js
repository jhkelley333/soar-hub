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
