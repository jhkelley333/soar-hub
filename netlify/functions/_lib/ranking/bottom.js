// Bottom performers by SDO, over this fiscal year's weekly ranker standings.
// For each SDO: the bottom-N GMs (store tier) and the bottom DO (do tier), by
// average weekly overall rank across FY2026 completed runs, with each entity's
// weekly rank series + a simple improving/declining trend.
//
// Scope: org-wide callers (storeNums == null) see every SDO; a scoped caller
// (RVP/SDO) is limited to the SDOs their stores roll up to.

// FY2026 window — matches src/lib/fiscal.ts (FY starts Mon Dec 29, 2025). Bump
// these when the fiscal year rolls over.
const FY_START = "2025-12-29";
const FY_END = "2026-12-27";

async function pageAll(make) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().range(from, from + 999);
    if (error || !data || !data.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

// Trend from an oldest→newest rank series (rank: lower is better). Compares the
// earlier half's average rank to the recent half's: a drop in rank = improving.
function trendOf(ranks) {
  if (ranks.length < 4) return { dir: "flat", delta: 0 };
  const mid = Math.floor(ranks.length / 2);
  const delta = mean(ranks.slice(0, mid)) - mean(ranks.slice(mid)); // + => rank fell => better
  return { dir: Math.abs(delta) < 1 ? "flat" : delta > 0 ? "improving" : "declining", delta: round1(delta) };
}

export async function bottomPerformers(supa, params, storeNums = null) {
  const gmPerSdo = Math.max(1, Math.min(5, parseInt(params.gm_per_sdo, 10) || 2));

  // All completed runs in the FY window, newest-first within each week. A week
  // can be re-run several times; keep only the NEWEST run per week_ending so we
  // count distinct weeks (not runs) and never double-count a week in the averages.
  const { data: runs } = await supa.from("ranking_runs")
    .select("id, week_ending, started_at").eq("status", "complete")
    .gte("week_ending", FY_START).lte("week_ending", FY_END)
    .order("week_ending", { ascending: true }).order("started_at", { ascending: false });
  const byWeek = new Map();
  for (const r of runs || []) if (!byWeek.has(r.week_ending)) byWeek.set(r.week_ending, r); // first per week = newest
  const runList = [...byWeek.values()];
  if (!runList.length) return { fy_start: FY_START, fy_end: FY_END, weeks: 0, gm_per_sdo: gmPerSdo, sdos: [] };
  const weekById = new Map(runList.map((r) => [r.id, r.week_ending]));

  const rows = await pageAll(() => supa.from("ranking_rows")
    .select("run_id, tier, entity_key, rank, total_points, metrics")
    .in("run_id", runList.map((r) => r.id)).eq("scope", "wtd").in("tier", ["store", "do"]));

  const stores = new Map(); // store# -> {number, gm, sdo, location, series:[{week,rank}], points:[]}
  const dos = new Map();    // DO name -> {name, sdo, series, points}
  for (const r of rows) {
    if (typeof r.rank !== "number") continue;
    const m = r.metrics || {};
    const week = weekById.get(r.run_id);
    if (r.tier === "store") {
      const num = String(m.store ?? r.entity_key);
      const e = stores.get(num) || { number: num, gm: null, sdo: null, location: null, series: [], points: [] };
      if (!e.gm && m.gm) e.gm = m.gm;
      if (!e.sdo && m.sdoName) e.sdo = m.sdoName;
      if (!e.location && m.location) e.location = m.location;
      e.series.push({ week, rank: r.rank });
      if (typeof r.total_points === "number") e.points.push(r.total_points);
      stores.set(num, e);
    } else {
      const name = String(m.name ?? r.entity_key);
      const e = dos.get(name) || { name, sdo: null, series: [], points: [] };
      if (!e.sdo && m.sdoName) e.sdo = m.sdoName;
      e.series.push({ week, rank: r.rank });
      if (typeof r.total_points === "number") e.points.push(r.total_points);
      dos.set(name, e);
    }
  }

  const allow = storeNums == null ? null : new Set(storeNums.map(String));
  const summarize = (e, isStore) => {
    e.series.sort((a, b) => (a.week < b.week ? -1 : 1));
    const ranks = e.series.map((s) => s.rank);
    return {
      ...(isStore ? { store_number: e.number, gm: e.gm || null, location: e.location || null } : { name: e.name }),
      sdo: e.sdo || "Unassigned",
      avg_rank: round1(mean(ranks)),
      avg_points: e.points.length ? round1(mean(e.points)) : null,
      best_rank: Math.min(...ranks),
      worst_rank: Math.max(...ranks),
      weeks: ranks.length,
      trend: trendOf(ranks),
      series: ranks,
    };
  };

  const storeArr = [...stores.values()]
    .filter((e) => (!allow || allow.has(e.number)) && e.series.length)
    .map((e) => summarize(e, true));
  // For scoped callers, only the SDOs their stores roll up to.
  const visibleSdos = allow ? new Set(storeArr.map((s) => s.sdo)) : null;
  const doArr = [...dos.values()]
    .filter((e) => e.series.length && (!visibleSdos || visibleSdos.has(e.sdo || "Unassigned")))
    .map((e) => summarize(e, false));

  const bySdo = new Map();
  const group = (sdo) => { const g = bySdo.get(sdo) || { sdo, gms: [], dos: [] }; bySdo.set(sdo, g); return g; };
  for (const s of storeArr) group(s.sdo).gms.push(s);
  for (const d of doArr) group(d.sdo).dos.push(d);

  // Bottom = worst average rank (highest number); tie-break by lower avg points.
  const worst = (a, b) => (b.avg_rank - a.avg_rank) || ((a.avg_points ?? 1e9) - (b.avg_points ?? 1e9));
  const sdos = [...bySdo.values()]
    .map((g) => ({
      sdo: g.sdo,
      store_count: g.gms.length,
      do_count: g.dos.length,
      bottom_gms: [...g.gms].sort(worst).slice(0, gmPerSdo),
      bottom_do: [...g.dos].sort(worst)[0] || null,
    }))
    .filter((g) => g.bottom_gms.length || g.bottom_do)
    .sort((a, b) => String(a.sdo).localeCompare(String(b.sdo)));

  return { fy_start: FY_START, fy_end: FY_END, weeks: runList.length, gm_per_sdo: gmPerSdo, sdos };
}
