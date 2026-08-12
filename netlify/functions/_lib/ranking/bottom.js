// Bottom performers by SDO, over this fiscal year's weekly ranker standings.
// For each SDO: the bottom-N GMs (store tier) and the bottom DO (do tier), by
// average of a chosen measure across FY2026 completed runs — Overall rank, a
// single component score (Labor / COGS / On-Time / VOG / …), or a controllables
// blend. Each entity carries its weekly series, best/worst, and a direction-
// aware improving/declining trend, plus its average overall rank for context.
//
// Scope: org-wide callers (storeNums == null) see every SDO; a scoped caller
// (RVP/SDO) is limited to the SDOs their stores roll up to.

// FY2026 window — matches src/lib/fiscal.ts (FY starts Mon Dec 29, 2025). Bump
// these when the fiscal year rolls over.
const FY_START = "2025-12-29";
const FY_END = "2026-12-27";

const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
const meanOf = (a) => { const v = a.filter((x) => x != null); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
const round = (v, d = 1) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

// Selectable measures. `get(row)` reads the value off a ranking_rows record
// (rank lives on the row; component scores are flat in metrics). betterIsHigher
// marks the good direction (rank: lower is better; scores: higher is better).
const METRICS = {
  overall:       { label: "Overall rank",         betterIsHigher: false, dec: 1, get: (r) => num(r.rank) },
  labor:         { label: "Labor score",          betterIsHigher: true,  dec: 2, get: (r) => num(r.metrics?.laborScore) },
  cogs:          { label: "COGS / Food score",    betterIsHigher: true,  dec: 2, get: (r) => num(r.metrics?.fcScore) },
  ontime:        { label: "On-Time score",        betterIsHigher: true,  dec: 2, get: (r) => num(r.metrics?.onTimeScore) },
  vog:           { label: "VOG score",            betterIsHigher: true,  dec: 2, get: (r) => num(r.metrics?.vogScore) },
  ecosure:       { label: "EcoSure score",        betterIsHigher: true,  dec: 2, get: (r) => num(r.metrics?.ecosureScore) },
  complaints:    { label: "Complaints score",     betterIsHigher: true,  dec: 2, get: (r) => num(r.metrics?.complaintsScore) },
  bsc:           { label: "BSC score",            betterIsHigher: true,  dec: 2, get: (r) => num(r.metrics?.bscScore) },
  // Controllables + speed: the levers an SDO/DO can move week to week.
  controllables: { label: "Controllables + Speed", betterIsHigher: true, dec: 2, get: (r) => meanOf([num(r.metrics?.laborScore), num(r.metrics?.fcScore), num(r.metrics?.onTimeScore)]) },
};
export const BOTTOM_METRICS = Object.entries(METRICS).map(([key, m]) => ({ key, label: m.label, better_is_higher: m.betterIsHigher }));

// Trend from an oldest→newest value series, direction-aware. Positive delta =
// improving (rank fell, or score rose).
function trendOf(series, betterIsHigher) {
  if (series.length < 4) return { dir: "flat", delta: 0 };
  const mid = Math.floor(series.length / 2);
  const early = meanOf(series.slice(0, mid));
  const recent = meanOf(series.slice(mid));
  if (early == null || recent == null) return { dir: "flat", delta: 0 };
  const delta = betterIsHigher ? recent - early : early - recent;
  const thresh = betterIsHigher ? 0.1 : 1;
  return { dir: Math.abs(delta) < thresh ? "flat" : delta > 0 ? "improving" : "declining", delta: round(delta, 2) };
}

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

export async function bottomPerformers(supa, params, storeNums = null) {
  const gmPerSdo = Math.max(1, Math.min(5, parseInt(params.gm_per_sdo, 10) || 2));
  const metricKey = METRICS[params.metric] ? params.metric : "overall";
  const M = METRICS[metricKey];

  // Newest completed run per week in the FY window (a week can be re-run).
  const { data: runs } = await supa.from("ranking_runs")
    .select("id, week_ending, started_at").eq("status", "complete")
    .gte("week_ending", FY_START).lte("week_ending", FY_END)
    .order("week_ending", { ascending: true }).order("started_at", { ascending: false });
  const byWeek = new Map();
  for (const r of runs || []) if (!byWeek.has(r.week_ending)) byWeek.set(r.week_ending, r);
  const runList = [...byWeek.values()];
  if (!runList.length) return { fy_start: FY_START, fy_end: FY_END, weeks: 0, gm_per_sdo: gmPerSdo, metric: metricKey, metric_label: M.label, better_is_higher: M.betterIsHigher, metrics: BOTTOM_METRICS, sdos: [] };
  const weekById = new Map(runList.map((r) => [r.id, r.week_ending]));

  const rows = await pageAll(() => supa.from("ranking_rows")
    .select("run_id, tier, entity_key, rank, total_points, metrics")
    .in("run_id", runList.map((r) => r.id)).eq("scope", "wtd").in("tier", ["store", "do"]));

  const stores = new Map(); // store# -> {number, gm, sdo, location, pts:[{week,val,rank}]}
  const dos = new Map();
  for (const r of rows) {
    const val = M.get(r);
    const rank = num(r.rank);
    if (val == null) continue;
    const m = r.metrics || {};
    const week = weekById.get(r.run_id);
    if (r.tier === "store") {
      const key = String(m.store ?? r.entity_key);
      const e = stores.get(key) || { number: key, gm: null, sdo: null, location: null, pts: [] };
      if (!e.gm && m.gm) e.gm = m.gm;
      if (!e.sdo && m.sdoName) e.sdo = m.sdoName;
      if (!e.location && m.location) e.location = m.location;
      e.pts.push({ week, val, rank });
      stores.set(key, e);
    } else {
      const key = String(m.name ?? r.entity_key);
      const e = dos.get(key) || { name: key, sdo: null, pts: [] };
      if (!e.sdo && m.sdoName) e.sdo = m.sdoName;
      e.pts.push({ week, val, rank });
      dos.set(key, e);
    }
  }

  const allow = storeNums == null ? null : new Set(storeNums.map(String));
  const summarize = (e, isStore) => {
    e.pts.sort((a, b) => (a.week < b.week ? -1 : 1));
    const vals = e.pts.map((p) => p.val);
    const ranks = e.pts.map((p) => p.rank).filter((x) => x != null);
    return {
      ...(isStore ? { store_number: e.number, gm: e.gm || null, location: e.location || null } : { name: e.name }),
      sdo: e.sdo || "Unassigned",
      value: round(meanOf(vals), M.dec),
      best: round(M.betterIsHigher ? Math.max(...vals) : Math.min(...vals), M.dec),
      worst: round(M.betterIsHigher ? Math.min(...vals) : Math.max(...vals), M.dec),
      avg_rank: ranks.length ? round(meanOf(ranks), 1) : null,
      weeks: vals.length,
      trend: trendOf(vals, M.betterIsHigher),
      series: vals.map((v) => round(v, M.dec)),
    };
  };

  const storeArr = [...stores.values()]
    .filter((e) => (!allow || allow.has(e.number)) && e.pts.length)
    .map((e) => summarize(e, true));
  const visibleSdos = allow ? new Set(storeArr.map((s) => s.sdo)) : null;
  const doArr = [...dos.values()]
    .filter((e) => e.pts.length && (!visibleSdos || visibleSdos.has(e.sdo || "Unassigned")))
    .map((e) => summarize(e, false));

  const bySdo = new Map();
  const group = (sdo) => { const g = bySdo.get(sdo) || { sdo, gms: [], dos: [] }; bySdo.set(sdo, g); return g; };
  for (const s of storeArr) group(s.sdo).gms.push(s);
  for (const d of doArr) group(d.sdo).dos.push(d);

  // Worst first: for higher-is-better, lowest value; else highest value (rank).
  // Tie-break by worse overall rank.
  const worst = (a, b) => (M.betterIsHigher ? a.value - b.value : b.value - a.value) || ((b.avg_rank ?? 0) - (a.avg_rank ?? 0));
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

  return {
    fy_start: FY_START, fy_end: FY_END, weeks: runList.length, gm_per_sdo: gmPerSdo,
    metric: metricKey, metric_label: M.label, better_is_higher: M.betterIsHigher, metrics: BOTTOM_METRICS, sdos,
  };
}
