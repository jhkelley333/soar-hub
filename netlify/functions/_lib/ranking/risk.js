// Risk engine: who's ABOUT to be in trouble. Scores every store from
// signals across the Hub — rank trajectory (archived sheet history + hub
// runs), labor-miss patterns and the root causes GMs file, leadership
// fragility (no GM / open-store credit tags), service slide, and data
// purity (a store you can't measure is a store you can't manage).
// Buckets: High (>=6), Watch (>=3), Stable. Reasons are always listed —
// never a bare score.

import { trendsData } from "./legacy.js";
import { latestRun } from "./run.js";

const isNum = (v) => typeof v === "number" && isFinite(v);

function isoDaysAgo(n) {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString().slice(0, 10);
}

const CAUSE_LABEL = {
  poor_projections: "Poor Projections",
  scheduled_above_chart: "Scheduled Above Chart",
  didnt_follow_schedule: "Didn't Follow the Schedule",
  auto_clock: "Auto Clock",
  other: "Other",
};
const TAG_LABEL = { loa: "GM on LOA", no_gm: "No GM (open store)", in_training: "GM in training" };

// Numeric tail of a series: the last `k` non-null values, in order.
function tail(arr, k) {
  const out = [];
  for (let i = arr.length - 1; i >= 0 && out.length < k; i--) {
    if (isNum(arr[i])) out.unshift(arr[i]);
  }
  return out;
}
const last = (arr) => (tail(arr, 1)[0] ?? null);

export async function riskData(supa) {
  // Trend axis (sheet + hub) and the latest hub run.
  const t = await trendsData(supa, { weeks: 9 });
  if (t.error) return t;
  const lr = await latestRun(supa, { scope: "ptd", tier: "store" });
  if (lr.error) return lr;
  const latestByStore = new Map((lr.rows || []).map((r) => [String(r.entity_key), r]));

  // Labor-miss root causes filed in the last 28 days (legacy + v2 share the table).
  const { data: reviews } = await supa
    .from("labor_reviews")
    .select("store_number, root_cause")
    .gte("business_date", isoDaysAgo(28))
    .limit(3000);
  const causes = new Map(); // number -> Map(cause -> count)
  for (const r of reviews || []) {
    const sn = String(r.store_number);
    if (!r.root_cause) continue;
    if (!causes.has(sn)) causes.set(sn, new Map());
    const m = causes.get(sn);
    m.set(r.root_cause, (m.get(r.root_cause) || 0) + 1);
  }

  // Active open-store / LOA / in-training tags.
  const today = new Date().toISOString().slice(0, 10);
  const { data: tags } = await supa.from("no_gm_credits").select("store_number, reason, start_date, end_date");
  const activeTag = new Map();
  for (const g of tags || []) {
    if (g.start_date <= today && (!g.end_date || g.end_date >= today)) {
      activeTag.set(String(g.store_number), g.reason);
    }
  }

  const out = [];
  for (const [num, s] of Object.entries(t.stores)) {
    const reasons = [];
    const add = (kind, pts, label) => { reasons.push({ kind, pts, label }); };

    // ── Trajectory ──
    const r4 = tail(s.rank, 4);
    if (r4.length >= 3) {
      let sliding = true;
      for (let i = 1; i < r4.length; i++) if (r4[i] <= r4[i - 1]) { sliding = false; break; }
      if (sliding) add("performance", 3, `Rank slid ${r4[r4.length - 1] - r4[0]} places over ${r4.length} straight weeks`);
      else if (r4[r4.length - 1] - r4[0] >= 15) add("performance", 2, `Rank down ${r4[r4.length - 1] - r4[0]} places vs ~4 weeks ago`);
    }

    // ── Labor pattern (sheet-era varToChart is weekly; count miss weeks) ──
    const lastRun = latestByStore.get(num);
    const m = lastRun?.metrics || {};
    if (isNum(m.varianceToChart) && m.varianceToChart > 0) {
      add("performance", 1, `Over labor chart this period (+${(m.varianceToChart * 100).toFixed(1)} pts vs IX target)`);
    }
    const storeCauses = causes.get(num);
    if (storeCauses) {
      for (const [cause, count] of storeCauses) {
        if (count >= 3) add("performance", 2, `${count}× "${CAUSE_LABEL[cause] ?? cause}" filed in 28 days — pattern, not incident`);
      }
    }

    // ── Leadership ──
    const tag = activeTag.get(num);
    if (tag) add("people", 2, TAG_LABEL[tag] ?? "Open-store credit active");
    else if (lastRun && !m.gm) add("people", 2, "No GM on file");

    // ── Service ──
    const ot = tail(s.ontime, 4);
    const otLast = last(s.ontime);
    if (isNum(otLast) && otLast < 70) add("performance", 2, `On-time at ${otLast.toFixed(1)}% (red band)`);
    if (ot.length >= 3 && ot[0] - ot[ot.length - 1] >= 5) add("performance", 1, `On-time down ${(ot[0] - ot[ot.length - 1]).toFixed(1)} pts over ${ot.length} weeks`);

    // ── Sales ──
    const vsly = last(s.vsly);
    if (isNum(vsly) && vsly < -10) add("performance", 1, `Sales ${vsly.toFixed(1)}% vs LY`);

    // ── Data purity ──
    if (lastRun) {
      if (lastRun.rank == null) add("data", 2, "Unranked in the latest run (no total points)");
      if (m.pctVsLy === "NO LY") add("data", 1, "No LY sales baseline");
      if (m.onTimePct == null) add("data", 1, "No on-time data");
      else if (isNum(m.onTimePct) && m.onTimePct > 1) add("data", 1, `On-time reads ${(m.onTimePct * 100).toFixed(0)}% — feed data suspect`);
      if (m.entity === "Unassigned") add("data", 1, "No legal entity on My Stores");
      if (isNum(m.cogsEff) && m.cogsEff <= 0) add("data", 2, "IX efficiency at/below zero — excluded from food cost");
    }

    if (!reasons.length) continue;
    const score = reasons.reduce((a, b) => a + b.pts, 0);
    out.push({
      number: num,
      name: s.name,
      gm: s.gm ?? (m.gm || null),
      rank: lastRun?.rank ?? last(s.rank),
      points: lastRun?.total_points ?? null,
      score,
      bucket: score >= 6 ? "high" : score >= 3 ? "watch" : "low",
      reasons,
    });
  }
  out.sort((a, b) => b.score - a.score);
  const counts = {
    high: out.filter((r) => r.bucket === "high").length,
    watch: out.filter((r) => r.bucket === "watch").length,
    low: out.filter((r) => r.bucket === "low").length,
    stable: Object.keys(t.stores).length - out.length,
  };
  return { generated_from_weeks: t.weeks.length, counts, stores: out };
}
