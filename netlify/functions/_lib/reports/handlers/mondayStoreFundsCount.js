// Report — "Store Funds (Bank) validation, current period" (compliance). DOs
// count each store's on-hand cash Bank in week 1 of every 4-week period and
// reconcile it to the assigned Bank amount (store_fund_settings). This report,
// for the current fiscal period, lists the stores STILL DUE (Bank not yet
// validated) and any that came in OVER TOLERANCE, grouped RVP -> DO, so COO +
// RVPs can chase them — mirroring the Cash Management → Store Funds tab.
//
// Universe = active stores that have a Bank set (a store_fund_settings row).
// "Validated this period" = a required (non-off-cycle) store_fund_validations
// row whose validated_at falls in the current period.

import { resolveOrg } from "../../kpiOrg.js";
import { fiscalForDate } from "../../fiscal.js";
import { wallClock } from "../core.js";

const pad = (n) => String(n).padStart(2, "0");
const isoOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const isoAddDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return isoOf(d); };
const money = (cents) => `$${(Number(cents || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (cents) => `${Number(cents) >= 0 ? "+" : "-"}$${Math.abs(Number(cents || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function mondayStoreFundsCount({ supa, definition, now }) {
  const tz = definition.timezone || "America/Chicago";
  const wc = wallClock(now, tz);
  const todayIso = `${wc.year}-${pad(wc.month)}-${pad(wc.day)}`;

  const fx = fiscalForDate(todayIso);
  const periodStart = fx ? fx.periodStart : isoAddDays(todayIso, -27);
  const periodEnd = fx ? fx.periodEnd : todayIso;
  const periodLabel = fx ? `Period ${fx.period} (${fx.fiscalYear})` : "current period";
  const weekInPeriod = fx ? fx.weekInPeriod : null;

  // Universe: active stores that have a Bank set.
  const [{ data: settings }, { data: storeRows }, { data: cashSettings }] = await Promise.all([
    supa.from("store_fund_settings").select("store_number, bank_amount_cents"),
    supa.from("stores").select("number, name, is_active").eq("is_active", true),
    supa.from("cash_settings").select("fund_tolerance_cents").limit(1).maybeSingle(),
  ]);
  const nameByNum = new Map((storeRows || []).map((s) => [String(s.number), s.name]));
  const bankByNum = new Map();
  for (const s of settings || []) {
    const sn = String(s.store_number);
    if (nameByNum.has(sn)) bankByNum.set(sn, s.bank_amount_cents);
  }
  const tolerance = cashSettings?.fund_tolerance_cents ?? 500;

  // Required (non-off-cycle) validations that landed this period; keep the
  // latest per store.
  const { data: vals } = await supa
    .from("store_fund_validations")
    .select("store_number, counted_cents, variance_cents, over_tolerance, validated_at, validated_by_name, is_off_cycle")
    .gte("validated_at", `${periodStart}T00:00:00`)
    .lte("validated_at", `${periodEnd}T23:59:59`)
    .eq("is_off_cycle", false);
  const latest = new Map();
  for (const v of vals || []) {
    const sn = String(v.store_number);
    if (!bankByNum.has(sn)) continue;
    const prev = latest.get(sn);
    if (!prev || new Date(v.validated_at) > new Date(prev.validated_at)) latest.set(sn, v);
  }

  const totalBanked = bankByNum.size;
  const validatedCount = latest.size;
  const dueNums = [...bankByNum.keys()].filter((sn) => !latest.has(sn));
  const overTol = [...latest.entries()]
    .filter(([, v]) => v.over_tolerance)
    .map(([sn, v]) => ({ sn, name: nameByNum.get(sn) || `#${sn}`, bank: bankByNum.get(sn), ...v }));

  const periodProgress = `${periodLabel}${weekInPeriod ? ` · Week ${weekInPeriod}` : ""}`;
  const HOW_TO_FIND = [
    "How to find it in Cash Management:",
    "  1. Open SOAR Hub → Cash Management → Store Funds tab.",
    "  2. Each store shows its Bank, Last Count, Variance, and a Validate button.",
    `  3. DOs count the store's Bank in Week 1 and hit Validate; over the ${money(tolerance)} tolerance escalates to the SDO.`,
    "  4. Chase the 'still due' stores below.",
  ];

  // All caught up.
  if (!dueNums.length && !overTol.length) {
    return {
      rowCount: 0,
      subject: `Store Funds — ${periodProgress}: all ${totalBanked} Banks validated, none over tolerance ✓`,
      text:
        `Store Funds (Bank) validation — ${periodProgress}\n` +
        `${totalBanked} stores with a Bank · ${validatedCount} validated this period · 0 due · 0 over tolerance.\n\n` +
        `Every store's Bank is validated for this period and within tolerance. Nothing to chase.\n\n` +
        `${HOW_TO_FIND.join("\n")}`,
      summary: { period: periodLabel, banked: totalBanked, validated: validatedCount, due: 0, over_tolerance: 0 },
    };
  }

  // Group the due list RVP -> DO (DOs do the validating).
  const org = await resolveOrg(supa, [...dueNums, ...overTol.map((o) => o.sn)]);
  const tree = new Map();
  for (const sn of dueNums) {
    const o = org.get(sn) || {};
    const rvp = o.rvpName || "Unassigned RVP";
    const doName = o.doName || "Unassigned DO";
    if (!tree.has(rvp)) tree.set(rvp, new Map());
    const dos = tree.get(rvp);
    if (!dos.has(doName)) dos.set(doName, []);
    dos.get(doName).push({ sn, name: o.store || nameByNum.get(sn) || `#${sn}`, bank: bankByNum.get(sn) });
  }

  const lines = [];
  lines.push(`Store Funds (Bank) validation — ${periodProgress}`);
  lines.push(`${totalBanked} stores with a Bank · ${validatedCount} validated this period · ${dueNums.length} still due · ${overTol.length} over tolerance`);
  lines.push("");

  if (dueNums.length) {
    lines.push(`STILL DUE — ${dueNums.length} store${dueNums.length === 1 ? "" : "s"} not yet validated this period:`);
    for (const [rvp, dos] of [...tree].sort((a, b) => a[0].localeCompare(b[0]))) {
      const rvpCount = [...dos.values()].reduce((a, arr) => a + arr.length, 0);
      lines.push(`  ${rvp} — ${rvpCount} due`);
      for (const [doName, arr] of [...dos].sort((a, b) => a[0].localeCompare(b[0]))) {
        lines.push(`    DO ${doName} — ${arr.length}`);
        for (const s of arr.sort((a, b) => a.name.localeCompare(b.name))) {
          lines.push(`      #${s.sn} ${s.name} — Bank ${money(s.bank)}`);
        }
      }
    }
    lines.push("");
  }

  if (overTol.length) {
    lines.push(`OVER TOLERANCE (> ${money(tolerance)}) — ${overTol.length} count${overTol.length === 1 ? "" : "s"} this period:`);
    for (const o of overTol.sort((a, b) => Math.abs(b.variance_cents) - Math.abs(a.variance_cents))) {
      lines.push(`  #${o.sn} ${o.name} — Bank ${money(o.bank)}, counted ${money(o.counted_cents)}, variance ${signed(o.variance_cents)}${o.validated_by_name ? ` (by ${o.validated_by_name})` : ""}`);
    }
    lines.push("");
  }

  lines.push(...HOW_TO_FIND);

  return {
    rowCount: dueNums.length + overTol.length,
    subject: `Store Funds — ${periodProgress}: ${dueNums.length} due, ${overTol.length} over tolerance`,
    text: lines.join("\n"),
    summary: {
      period: periodLabel, banked: totalBanked, validated: validatedCount,
      due: dueNums.length, over_tolerance: overTol.length,
    },
  };
}
