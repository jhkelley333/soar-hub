// Report — "Store Funds Count, current period" (compliance). For the current
// fiscal period, lists the stores that are MISSING nightly cash counts in Cash
// Management (a cash_closeouts row per store per business date), grouped
// RVP → DO, so COO + RVPs can chase the gaps. Not a dollar report — it tracks
// who has / hasn't counted.
//
// "Enrolled" stores (the ones expected to count) = any active store with at
// least one closeout in the last ~30 days, so stores not using Cash Management
// don't show up as false gaps, while a store that WAS counting and stopped
// surfaces as all-missing. Closed-day gaps (business disruptions) can show as
// missing; that's acceptable for a chase list.

import { resolveOrg } from "../../kpiOrg.js";
import { fiscalForDate } from "../../fiscal.js";
import { wallClock } from "../core.js";

const pad = (n) => String(n).padStart(2, "0");
const isoOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const isoAddDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return isoOf(d); };
function daysBetween(startIso, endIso) {
  const out = [];
  let d = new Date(`${startIso}T12:00:00Z`);
  const end = new Date(`${endIso}T12:00:00Z`);
  while (d <= end) { out.push(isoOf(d)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}
const fmtDay = (iso) => new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

const HOW_TO_FIND = [
  "How to find it in Cash Management:",
  "  1. Open SOAR Hub → Cash Management (/admin/cash-management).",
  "  2. Pick the store, then a business date. A submitted nightly count shows the",
  "     counted drawer total + deposit; a date with no entry is a missing count.",
  "  3. The store manager submits the count from that page after counting the",
  "     drawer at close — chase the missing dates listed above.",
];

export async function mondayStoreFundsCount({ supa, definition, now }) {
  const tz = definition.timezone || "America/Chicago";
  const wc = wallClock(now, tz);
  const todayIso = `${wc.year}-${pad(wc.month)}-${pad(wc.day)}`;

  // Current fiscal period; fall back to a trailing 4 weeks if the fiscal
  // calendar doesn't cover today (year boundary).
  const fx = fiscalForDate(todayIso);
  const periodStart = fx ? fx.periodStart : isoAddDays(todayIso, -27);
  const periodEnd = fx ? fx.periodEnd : todayIso;
  const periodLabel = fx ? `Period ${fx.period} (${fx.fiscalYear})` : "last 4 weeks";

  // Evaluate counts for full business days only: period start → yesterday.
  const yesterday = isoAddDays(todayIso, -1);
  const evalEnd = yesterday < periodEnd ? yesterday : periodEnd;

  if (evalEnd < periodStart) {
    return {
      rowCount: 0,
      subject: `Store Funds Count — ${periodLabel}: new period, nothing to count yet`,
      text: `${periodLabel} just started (${periodStart}). No business days have closed yet, so there are no cash counts to check.\n\n${HOW_TO_FIND.join("\n")}`,
      summary: { period: periodLabel, period_start: periodStart, eval_end: null, enrolled: 0, gaps: 0 },
    };
  }

  const days = daysBetween(periodStart, evalEnd);

  // One query over a widened range: in-period rows build the submitted map;
  // every store_number seen defines the "enrolled" (actively counting) set.
  const { data: closeouts } = await supa
    .from("cash_closeouts")
    .select("store_number, business_date")
    .gte("business_date", isoAddDays(periodStart, -30))
    .lte("business_date", evalEnd);

  const submitted = new Map(); // store_number → Set(business_date in period)
  const enrolled = new Set();
  for (const c of closeouts || []) {
    const sn = String(c.store_number);
    enrolled.add(sn);
    const bd = String(c.business_date).slice(0, 10);
    if (bd >= periodStart && bd <= evalEnd) {
      if (!submitted.has(sn)) submitted.set(sn, new Set());
      submitted.get(sn).add(bd);
    }
  }

  // Keep only enrolled stores that are still active.
  const { data: storeRows } = await supa.from("stores").select("number, name, is_active").eq("is_active", true);
  const nameByNum = new Map((storeRows || []).map((s) => [String(s.number), s.name]));
  const enrolledActive = [...enrolled].filter((sn) => nameByNum.has(sn));

  // Gap = an enrolled store missing one or more business days this period.
  const gaps = [];
  let totalMissingDays = 0;
  for (const sn of enrolledActive) {
    const have = submitted.get(sn) || new Set();
    const missing = days.filter((d) => !have.has(d));
    if (missing.length) { gaps.push({ sn, missing }); totalMissingDays += missing.length; }
  }
  const fullyCounted = enrolledActive.length - gaps.length;

  if (!gaps.length) {
    return {
      rowCount: 0,
      subject: `Store Funds Count — ${periodLabel}: all ${enrolledActive.length} stores current ✓`,
      text:
        `Store Funds Count — ${periodLabel}\n` +
        `Days checked: ${periodStart} → ${evalEnd} (${days.length} business days)\n\n` +
        `All ${enrolledActive.length} counting stores have a submitted cash count for every business day this period. No gaps.\n\n` +
        `${HOW_TO_FIND.join("\n")}`,
      summary: { period: periodLabel, period_start: periodStart, eval_end: evalEnd, enrolled: enrolledActive.length, fully_counted: enrolledActive.length, gaps: 0, missing_days: 0 },
    };
  }

  // Group gap stores RVP → DO.
  const org = await resolveOrg(supa, gaps.map((g) => g.sn));
  const tree = new Map();
  for (const g of gaps) {
    const o = org.get(g.sn) || {};
    const rvp = o.rvpName || "Unassigned RVP";
    const doName = o.doName || "Unassigned DO";
    if (!tree.has(rvp)) tree.set(rvp, new Map());
    const dos = tree.get(rvp);
    if (!dos.has(doName)) dos.set(doName, []);
    dos.get(doName).push({ ...g, name: o.store || nameByNum.get(g.sn) || `#${g.sn}` });
  }

  const lines = [];
  lines.push(`Store Funds Count — ${periodLabel}`);
  lines.push(`Days checked: ${periodStart} → ${evalEnd} (${days.length} business days)`);
  lines.push(`${enrolledActive.length} counting stores · ${fullyCounted} fully counted · ${gaps.length} with gaps · ${totalMissingDays} missing count-day${totalMissingDays === 1 ? "" : "s"}`);
  lines.push("");

  for (const [rvp, dos] of [...tree].sort((a, b) => a[0].localeCompare(b[0]))) {
    const rvpMissing = [...dos.values()].reduce((a, arr) => a + arr.reduce((b, g) => b + g.missing.length, 0), 0);
    lines.push(`${rvp} — ${rvpMissing} missing count-day${rvpMissing === 1 ? "" : "s"}`);
    for (const [doName, arr] of [...dos].sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`  DO ${doName}`);
      for (const g of arr.sort((a, b) => a.name.localeCompare(b.name))) {
        const shown = g.missing.slice(0, 10).map(fmtDay).join(", ");
        const extra = g.missing.length > 10 ? ` (+${g.missing.length - 10} more)` : "";
        lines.push(`    #${g.sn} ${g.name} — ${g.missing.length} of ${days.length} missing: ${shown}${extra}`);
      }
    }
    lines.push("");
  }
  lines.push(...HOW_TO_FIND);

  return {
    rowCount: gaps.length,
    subject: `Store Funds Count — ${periodLabel}: ${gaps.length} store${gaps.length === 1 ? "" : "s"} with missing counts`,
    text: lines.join("\n"),
    summary: {
      period: periodLabel, period_start: periodStart, eval_end: evalEnd,
      enrolled: enrolledActive.length, fully_counted: fullyCounted, gaps: gaps.length, missing_days: totalMissingDays,
    },
  };
}
