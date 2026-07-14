// Build the ranking engine's inputs from live Hub data, run it, persist the
// run + rows. The adapter encodes the decided deviations:
//   B1  chart = Labor v2's per-store IX target (chart2 = chart1 interim)
//   B7  labor arrives CREDIT-ADJUSTED (training/PTO/no-GM applied via the
//       shared pipeline); the engine's own credit inputs are zeroed
//   B8  avgWage = live company average from the anchor rows (cost / hours)
//   A   missing IX -> store treated as 96.0% efficiency (sheet rule) until
//       the IX parser lands; complaints on hold (B6) -> neutral 3
import { fiscalForDate } from "../fiscal.js";
import { resolveOrg } from "../kpiOrg.js";
import { loadLaborCredits, applyCreditsToRows } from "../trainingCredit.js";
import { backfillLaborDate } from "../kpiBackfill.js";
import { loadRankingConfig } from "./config.js";
import engine from "./engine.cjs";

const isNum = (v) => typeof v === "number" && isFinite(v);
const numOrNull = (v) => (v == null || isNaN(Number(v)) ? null : Number(v));

function isoAddDays(iso, n) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

const REQUIRED_BANDS = ["sales_vs_ly", "food_cost", "bsc_training", "on_time", "complaints", "food_safety", "vog", "total_training"];

// Food-cost dollars run over the TARGET efficiency (default 96%):
// actual - ideal/target, floored at 0. Prefers the IX actual/ideal dollars;
// reconstructs them from variance + efficiency for files ingested before
// those columns were captured. Savers (eff >= target) miss $0.
function fcMissVsTarget(ix, target) {
  if (!ix) return 0;
  const n = (v) => (typeof v === "number" && isFinite(v) ? v : Number.isFinite(Number(v)) ? Number(v) : 0);
  let actual = n(ix.actual_dollars);
  let ideal = n(ix.ideal_dollars);
  if (!(actual > 0) || !(ideal > 0)) {
    // Reconstruct: fc_variance = ideal - actual; cogs_eff = ideal / actual.
    const eff = n(ix.cogs_eff), variance = n(ix.fc_variance);
    if (eff > 0 && eff < 1) { actual = -variance / (1 - eff); ideal = eff * actual; }
    else return 0; // eff >= 1 (saver) or unusable -> no miss
  }
  if (!(actual > 0) || !(ideal > 0) || !(target > 0)) return 0;
  return Math.max(0, actual - ideal / target);
}

// One band's engine input from a labor_v2_daily row (prefix "wtd_"/"ptd_")
// plus that store's IX payload for the matching scope (null until ingested).
function bandInput(r, p, ix, fcTarget) {
  const otDen = Number(r[p + "on_time_denominator"]);
  const otNum = Number(r[p + "on_time_numerator"]);
  return {
    sales: numOrNull(r[p + "net_sales"]),
    lySales: numOrNull(r[p + "prev_year_net_sales"]),
    tickets: numOrNull(r[p + "tickets"]),
    lyTickets: numOrNull(r[p + "prev_year_tickets"]),
    custCount: numOrNull(r[p + "tickets"]),
    laborPct: numOrNull(r[p + "labor_pct"]),                 // credit-adjusted (B7)
    chart1: numOrNull(r[p + "target_labor_pct"]),            // IX target (B1)
    chart2: numOrNull(r[p + "target_labor_pct"]),            // interim: = chart1 (B2 addendum)
    trainingCreditDollars: 0,                                 // B7: already inside laborPct
    ptoDollars: 0,                                            // B7
    // IX category export when ingested; the sheet's missing-IX rule (96.0%)
    // otherwise. A store absent from the file also gets 96.0%.
    cogsEff: isNum(ix?.cogs_eff) ? ix.cogs_eff : 0.96,
    // FC $ miss = actual over the target-efficiency cost (default 96%), $0 at/above.
    fcMiss: ix ? fcMissVsTarget(ix, fcTarget) : 0,
    onTimePct: isFinite(otDen) && otDen > 0 && isFinite(otNum) ? otNum / otDen : null,
    voids: numOrNull(r[p + "void_total"]),
    callsPer10k: null,                                        // B6: on hold -> neutral 3
    ecosure: null, vogScore: null, vogResponses: null,        // parsers not wired yet
    totalTrainingPct: null, msCount: null, msScore: null,
    doh: isNum(ix?.doh) ? ix.doh : null,
    dohGoal: null,
    endingDollars: isNum(ix?.ending_dollars) ? ix.ending_dollars : null,
    dollarsOverGoal: isNum(ix?.excess_dollars) ? ix.excess_dollars : null,
  };
}

// Latest parsed upload of a store-keyed source (totzone, bsc, ...): newest
// file wins; rows map by store code.
async function loadLatestUpload(supa, source) {
  const { data: files } = await supa
    .from("ranking_source_files")
    .select("id, week_ending, uploaded_at")
    .eq("source", source).eq("status", "parsed")
    .order("uploaded_at", { ascending: false }).limit(1);
  const f = files?.[0];
  if (!f) return null;
  const { data: rows } = await supa.from("ranking_src_rows").select("payload").eq("file_id", f.id).limit(2500);
  const stores = new Map();
  const list = [];
  for (const { payload: p } of rows || []) {
    if (!p?.store_code) continue;
    stores.set(String(p.store_code), p); // last-wins map (single-row-per-store sources)
    list.push(p);                        // full list (multi-row sources, e.g. assessments)
  }
  return { file: f, stores, list };
}

// Latest ingested IX file per scope, preferring an exact week match. Returns
// { ptd, wtd } where each is { week, stale, stores: Map, rollups, flash }.
async function loadIxForWeek(supa, weekEnding, issues) {
  const out = { ptd: null, wtd: null };
  const { data: files, error } = await supa
    .from("ranking_source_files")
    .select("id, week_ending, uploaded_at")
    .eq("source", "ix").eq("status", "parsed")
    .order("uploaded_at", { ascending: false }).limit(24);
  if (error || !files?.length) return out;

  const withScope = [];
  for (const f of files) {
    const { data: probe } = await supa.from("ranking_src_rows").select("payload").eq("file_id", f.id).limit(1);
    withScope.push({ ...f, scope: probe?.[0]?.payload?.scope === "wtd" ? "wtd" : "ptd" });
  }
  for (const scope of ["ptd", "wtd"]) {
    const cands = withScope.filter((f) => f.scope === scope);
    if (!cands.length) continue;
    const pick = cands.find((f) => f.week_ending === weekEnding) ?? cands[0];
    const { data: rows } = await supa.from("ranking_src_rows").select("payload").eq("file_id", pick.id).limit(2000);
    const storeMap = new Map();
    const rollups = { do: {}, sdo: {}, rvp: {}, company: null };
    let flash = 0;
    for (const { payload: p } of rows || []) {
      if (String(p.status || "").toLowerCase() === "flash") flash++;
      if (p.level === "store" && p.store_code) storeMap.set(String(p.store_code), p);
      else if (p.level === "do" && p.leader) rollups.do[p.leader] = { cogsEff: p.cogs_eff, doh: p.doh };
      else if (p.level === "sdo" && p.leader) rollups.sdo[p.leader] = { cogsEff: p.cogs_eff, doh: p.doh };
      else if (p.level === "rvp" && p.leader) rollups.rvp[p.leader] = { cogsEff: p.cogs_eff, doh: p.doh };
      else if (p.level === "company") rollups.company = { cogsEff: p.cogs_eff, doh: p.doh };
    }
    out[scope] = { week: pick.week_ending, stale: pick.week_ending !== weekEnding, stores: storeMap, rollups, flash };
    if (pick.week_ending !== weekEnding) {
      issues.push({ level: "warn", msg: `IX ${scope.toUpperCase()} file is for week ending ${pick.week_ending} — food cost carries that week's numbers (stale).` });
    }
  }
  return out;
}

export async function runRankingNow(supa, user) {
  const issues = [];

  // 1. Anchor: the most recent COMPLETED fiscal week's Sunday with data.
  const { data: lastRow, error: lastErr } = await supa
    .from("labor_v2_daily").select("business_date")
    .order("business_date", { ascending: false }).limit(1);
  if (lastErr) return { error: lastErr.message, status: 500 };
  const latest = lastRow?.[0]?.business_date;
  if (!latest) return { error: "No Labor v2 data captured yet — nothing to rank.", status: 400 };
  const fiLatest = fiscalForDate(latest);
  if (!fiLatest) return { error: `Latest business date ${latest} is outside the fiscal calendar.`, status: 500 };
  const weekEnding = fiLatest.isWeekEnd ? latest : isoAddDays(fiLatest.weekStart, -1);
  const fi = fiscalForDate(weekEnding);
  if (!fi) return { error: `Week ending ${weekEnding} is outside the fiscal calendar.`, status: 500 };
  if (!fiLatest.isWeekEnd) {
    issues.push({ level: "info", msg: `Latest data is ${latest} (mid-week) — reporting the last completed week, ending ${weekEnding}.` });
  }

  // 2. Anchor rows. If the anchor Sunday predates migration 0238's fields
  // (tickets/on-time/voids), self-heal by re-extracting the stored KPI
  // snapshot for that date - the raw payloads carried them all along.
  const { data: probe } = await supa
    .from("labor_v2_daily")
    .select("ptd_tickets, on_time_denominator")
    .eq("business_date", weekEnding)
    .not("net_sales", "is", null)
    .limit(1);
  const p0 = probe?.[0];
  if (p0 && p0.ptd_tickets == null && p0.on_time_denominator == null) {
    const bf = await backfillLaborDate(supa, weekEnding);
    if (bf.ok) issues.push({ level: "info", msg: `Backfilled tickets/on-time/voids for ${weekEnding} from the stored KPI snapshot (${bf.from}).` });
    else issues.push({ level: "warn", msg: `Couldn't backfill ${weekEnding} from stored snapshots (${bf.error}).` });
  }

  // Credit-adjusted through the same pipeline the labor pages use.
  const { data: rows, error: rowsErr } = await supa.from("labor_v2_daily").select("*").eq("business_date", weekEnding);
  if (rowsErr) return { error: rowsErr.message, status: 500 };
  if (!rows?.length) {
    return { error: `No Labor v2 rows for week ending ${weekEnding} — the fiscal Sunday was never captured.`, status: 400 };
  }
  const numbers = [...new Set(rows.map((r) => String(r.store_number)))];
  applyCreditsToRows(rows, await loadLaborCredits(supa, numbers));

  // 3. Org + entity.
  const orgMap = await resolveOrg(supa, numbers);
  const { data: storeMeta } = await supa.from("stores").select("id, number, name, soar_company_name").in("number", numbers);
  const metaByNumber = new Map((storeMeta || []).map((s) => [String(s.number), s]));

  // 4. Config slice + live avg wage (B8).
  const rc = await loadRankingConfig(supa, weekEnding);
  const missingBands = REQUIRED_BANDS.filter((k) => !rc.bands[k]);
  if (missingBands.length) {
    return { error: `Missing band config: ${missingBands.join(", ")} — run migration 0239 on Soar Hub v2.`, status: 500 };
  }
  let costSum = 0, hrsSum = 0;
  for (const r of rows) {
    costSum += Number(r.ptd_labor_cost) || 0;
    hrsSum += Number(r.ptd_labor_hours) || 0;
  }
  let avgWage = hrsSum > 0 ? costSum / hrsSum : null;
  if (!isNum(avgWage) || avgWage <= 0) {
    avgWage = 12.84;
    issues.push({ level: "warn", msg: "Couldn't compute company avg wage from Labor v2 — fell back to 12.84." });
  }
  const weeksInPeriod = Math.round(((Date.parse(fi.periodEnd) - Date.parse(fi.periodStart)) / 86400000 + 1) / 7);
  issues.push({ level: "info", msg: `Food cost miss measured against ${(rc.fcTargetEfficiency * 100).toFixed(1)}% target efficiency (adjustable in System Settings).` });

  // 5. Engine inputs (IX food cost + TotZone training join here when ingested).
  const ix = await loadIxForWeek(supa, weekEnding, issues);
  const tz = await loadLatestUpload(supa, "totzone");
  if (tz) {
    const asOf = tz.file.week_ending;
    if (asOf && asOf < weekEnding) {
      issues.push({ level: "warn", msg: `TotZone status is as of ${asOf} — older than the week being ranked (stale).` });
    } else if (asOf) {
      issues.push({ level: "info", msg: `Total Training uses TotZone status as of ${asOf}.` });
    }
  }

  // EcoSure: YTD assessments — a store's input is the AVERAGE of its
  // assessment scores (brief section 6); unaudited stores stay null and the
  // engine renders "No Audit" with a neutral 3.
  const bsc = await loadLatestUpload(supa, "bsc");
  if (bsc) {
    const asOf = bsc.file.week_ending;
    if (asOf && asOf < weekEnding) issues.push({ level: "warn", msg: `BSC training is as of ${asOf} — older than the week being ranked (stale).` });
    else if (asOf) issues.push({ level: "info", msg: `BSC training uses status as of ${asOf}.` });
  }

  // Mystery Shops: keep only shops whose visit fell WITHIN this run's fiscal
  // period (Heath), then per store: msCount = # in-period shops, msScore =
  // average score. Information only — never counted toward Total Points.
  const shops = await loadLatestUpload(supa, "shops");
  const shopByStore = new Map();
  if (shops) {
    let inPeriod = 0;
    for (const p of shops.list) {
      if (!p.visit_date || p.visit_date < fi.periodStart || p.visit_date > fi.periodEnd) continue;
      const s = Number(p.score);
      if (!isFinite(s)) continue;
      inPeriod++;
      const cur = shopByStore.get(String(p.store_code)) || { sum: 0, n: 0 };
      cur.sum += s; cur.n++;
      shopByStore.set(String(p.store_code), cur);
    }
    issues.push({ level: "info", msg: `Mystery Shops: ${inPeriod} shop(s) within the period (${fi.periodStart}–${fi.periodEnd}) across ${shopByStore.size} store(s); shops outside the period are ignored.` });
  }

  // VOG per scope: newest file for each of wtd/ptd (the "MTD" export = PTD).
  // A store's VOG input is L2R (likely-to-return top-box); responses = Count.
  const vog = { ptd: new Map(), wtd: new Map() };
  {
    const { data: vfiles } = await supa.from("ranking_source_files")
      .select("id, uploaded_at").eq("source", "vog").eq("status", "parsed")
      .order("uploaded_at", { ascending: false }).limit(12);
    const seenScope = new Set();
    for (const f of vfiles || []) {
      const { data: probe } = await supa.from("ranking_src_rows").select("payload").eq("file_id", f.id).limit(1);
      const sc = probe?.[0]?.payload?.scope === "wtd" ? "wtd" : "ptd";
      if (seenScope.has(sc)) continue;
      seenScope.add(sc);
      const { data: vrows } = await supa.from("ranking_src_rows").select("payload").eq("file_id", f.id).limit(2000);
      for (const { payload: p } of vrows || []) if (p?.store_code) vog[sc].set(String(p.store_code), p);
    }
    if (vog.ptd.size || vog.wtd.size) {
      issues.push({ level: "info", msg: `VOG loaded — PTD ${vog.ptd.size} store(s), WTD ${vog.wtd.size} store(s).` });
    }
  }

  const eco = await loadLatestUpload(supa, "ecosure");
  const ecoAvgByStore = new Map();
  if (eco) {
    const sums = new Map();
    for (const p of eco.list) {
      const s = Number(p.score);
      if (!isFinite(s)) continue;
      const cur = sums.get(String(p.store_code)) || { sum: 0, n: 0 };
      cur.sum += s; cur.n++;
      sums.set(String(p.store_code), cur);
    }
    for (const [sn, { sum, n }] of sums) ecoAvgByStore.set(sn, sum / n / 100); // fraction, engine unit
    issues.push({ level: "info", msg: `EcoSure covers ${ecoAvgByStore.size} store(s) (YTD through ${eco.file.week_ending ?? "?"}) — unaudited stores score a neutral 3 ("No Audit").` });
  }
  const stores = [];
  const unmatched = [];
  const onTimeSuspect = [];
  const badIx = [];
  let ixMissing = 0;
  let onTimeMissing = 0;
  for (const r of rows) {
    const num = String(r.store_number);
    const org = orgMap.get(num);
    if (!org) { unmatched.push(num); continue; }
    const meta = metaByNumber.get(num);
    const ixPtd = ix.ptd?.stores.get(num) ?? null;
    const ixWtd = ix.wtd?.stores.get(num) ?? null;
    if (ix.ptd && !ixPtd) ixMissing++;
    if (isNum(ixPtd?.cogs_eff) && ixPtd.cogs_eff <= 0) badIx.push(`${num} (${(ixPtd.cogs_eff * 100).toFixed(1)}%)`);
    const ptd = bandInput(r, "ptd_", ixPtd, rc.fcTargetEfficiency);
    const wtd = bandInput(r, "wtd_", ixWtd, rc.fcTargetEfficiency);
    // Total Training (PTD-only; WTD's contract excludes it). Scored 1-5 but
    // never counted toward Total Points (DEVIATIONS A).
    const tzRow = tz?.stores.get(num);
    if (isNum(tzRow?.total_training_pct)) ptd.totalTrainingPct = tzRow.total_training_pct;
    // EcoSure YTD average (PTD-only, same contract).
    const ecoAvg = ecoAvgByStore.get(num);
    if (isNum(ecoAvg)) ptd.ecosure = ecoAvg;
    // BSC LTO training % — an ops-scoring category on both PTD and WTD.
    const bscRow = bsc?.stores.get(num);
    if (isNum(bscRow?.bsc_pct)) { ptd.bscTrainingPct = bscRow.bsc_pct; wtd.bscTrainingPct = bscRow.bsc_pct; }
    // Mystery Shops (in-period): count + average, informational.
    const sh = shopByStore.get(num);
    if (sh && sh.n) { ptd.msCount = sh.n; ptd.msScore = sh.sum / sh.n; }
    // VOG L2R + response count, per scope.
    const vp = vog.ptd.get(num);
    if (vp && isNum(vp.l2r)) { ptd.vogScore = vp.l2r; ptd.vogResponses = isNum(vp.count) ? vp.count : null; }
    const vw = vog.wtd.get(num);
    if (vw && isNum(vw.l2r)) { wtd.vogScore = vw.l2r; wtd.vogResponses = isNum(vw.count) ? vw.count : null; }
    if (ptd.onTimePct == null) onTimeMissing++;
    // The feed sometimes reports an on-time numerator above its denominator.
    // The score is unaffected (>=80% is already a 5) but suspect data never
    // passes silently.
    else if (ptd.onTimePct > 1) onTimeSuspect.push(`${num} (${(ptd.onTimePct * 100).toFixed(0)}%)`);
    stores.push({
      store: num,
      location: meta?.name ?? org.store ?? num,
      gm: org.gmName ?? null,
      doName: org.doName ?? (org.district ? `${org.district} (no DO)` : "Unassigned"),
      sdoName: org.sdoName ?? (org.area ? `${org.area} (no SDO)` : "Unassigned"),
      rvpName: org.rvpName ?? (org.region ? `${org.region} (no RVP)` : "Unassigned"),
      entity: meta?.soar_company_name || "Unassigned",
      tenureSoar: null, tenureLoc: null,
      laborPad: null, // B1: pads not applied
      ptd, wtd,
    });
  }
  if (!stores.length) return { error: "No feed stores matched the org — check store numbers.", status: 500 };
  if (unmatched.length) {
    issues.push({ level: "warn", msg: `${unmatched.length} feed store(s) not in the org: ${unmatched.slice(0, 10).join(", ")}${unmatched.length > 10 ? " …" : ""}` });
  }
  if (onTimeMissing === stores.length) {
    issues.push({ level: "bad", msg: "No on-time data captured yet (run migration 0238, then wait for the next KPI capture) — ops scores and total points will be blank." });
  } else if (onTimeMissing) {
    issues.push({ level: "warn", msg: `${onTimeMissing} store(s) missing on-time — they show without total points.` });
  }
  if (onTimeSuspect.length) {
    issues.push({ level: "warn", msg: `${onTimeSuspect.length} store(s) report PTD on-time above 100% — feed data suspect: ${onTimeSuspect.slice(0, 8).join(", ")}${onTimeSuspect.length > 8 ? " …" : ""}` });
  }
  if (badIx.length) {
    issues.push({ level: "bad", msg: `${badIx.length} store(s) excluded from ranking — IX efficiency at or below zero: ${badIx.join(", ")}. Fix the IX row or they stay unranked.` });
  }
  if (ixMissing) {
    issues.push({ level: "warn", msg: `${ixMissing} store(s) not in the IX file — they default to 96.0% efficiency (the sheet's missing-IX rule).` });
  }
  const entityMissing = stores.filter((s) => s.entity === "Unassigned").length;
  if (entityMissing) {
    issues.push({ level: "warn", msg: `${entityMissing} store(s) have no legal entity on My Stores (soar_company_name) — grouped as "Unassigned" on the Entities tab.` });
  }

  const out = engine.runRanking({
    config: { bands: rc.bands, laborChart: [], avgWage, period: fi.period, week: fi.weekInPeriod, weeksInPeriod, weekEnding },
    stores,
    leaderTrainingCredit: {},
    leaders: {},
    // Measured IX rollups (brief section 6: prefer measured over computed).
    rollups: {
      do: ix.ptd?.rollups.do ?? {},
      sdo: ix.ptd?.rollups.sdo ?? {},
      rvp: ix.ptd?.rollups.rvp ?? {},
      company: ix.ptd?.rollups.company ?? {},
      wtdDo: ix.wtd?.rollups.do ?? {},
      wtdSdo: ix.wtd?.rollups.sdo ?? {},
      wtdRvp: ix.wtd?.rollups.rvp ?? {},
      wtdCompany: ix.wtd?.rollups.company ?? {},
    },
  });

  // 6. Persist run + rows.
  const sourceStatus = {
    skunkworks: { status: "ok", stores: stores.length, week_ending: weekEnding, snapshot_latest: latest },
    ix: ix.ptd
      ? { status: ix.ptd.stale ? "stale" : "ok", week_ending: ix.ptd.week, stores: ix.ptd.stores.size, flash: ix.ptd.flash, wtd: ix.wtd ? (ix.wtd.stale ? "stale" : "ok") : "missing" }
      : { status: "missing", note: "COGS defaults to 96.0% (sheet's missing-IX rule)" },
    ecosure: eco
      ? { status: "ok", as_of: eco.file.week_ending, stores: ecoAvgByStore.size }
      : { status: "missing" },
    vog: (vog.ptd.size || vog.wtd.size)
      ? { status: "ok", ptd: vog.ptd.size, wtd: vog.wtd.size }
      : { status: "missing" },
    shops: shops
      ? { status: "ok", as_of: shops.file.week_ending, stores: shopByStore.size, in_period: [...shopByStore.values()].reduce((a, b) => a + b.n, 0) }
      : { status: "missing" },
    bsc: bsc
      ? { status: bsc.file.week_ending && bsc.file.week_ending < weekEnding ? "stale" : "ok", as_of: bsc.file.week_ending, stores: bsc.stores.size }
      : { status: "missing" },
    totzone: tz
      ? { status: tz.file.week_ending && tz.file.week_ending < weekEnding ? "stale" : "ok", as_of: tz.file.week_ending, stores: tz.stores.size }
      : { status: "missing" },
    complaints: { status: "on_hold" },
  };
  const { data: run, error: runErr } = await supa.from("ranking_runs").insert({
    week_ending: weekEnding,
    period: fi.period,
    week: fi.weekInPeriod,
    weeks_in_period: weeksInPeriod,
    config_version: rc.configVersion ?? weekEnding,
    snapshot_date: latest,
    snapshot_week_start: fiLatest.weekStart,
    week_misaligned: false,
    status: "running", // flips to complete only after every row lands
    issues,
    source_status: sourceStatus,
    started_by: user.id,
  }).select("id").single();
  if (runErr) {
    if (/ranking_runs/.test(runErr.message)) return { error: "Run migration 0237 first (ranking tables are missing).", status: 500 };
    return { error: `Couldn't save the run: ${runErr.message}`, status: 500 };
  }

  const idByNumber = new Map((storeMeta || []).map((s) => [String(s.number), s.id]));
  const rowsOut = [];
  const push = (scope, tier, list, keyFn) => {
    for (const m of list || []) {
      rowsOut.push({
        run_id: run.id, scope, tier,
        entity_key: keyFn(m),
        store_id: tier === "store" ? (idByNumber.get(String(m.store)) ?? null) : null,
        rank: m.rank ?? null,
        total_points: isNum(m.totalPoints) ? m.totalPoints : null,
        metrics: m,
      });
    }
  };
  for (const scope of ["ptd", "wtd"]) {
    const t = out[scope];
    push(scope, "store", t.stores, (m) => String(m.store));
    push(scope, "do", t.dos, (m) => String(m.name));
    push(scope, "sdo", t.sdos, (m) => String(m.name));
    push(scope, "rvp", t.rvps, (m) => String(m.name));
    push(scope, "entity", t.entities, (m) => String(m.name));
    push(scope, "company", [t.company], () => "SOAR QSR");
  }
  for (let i = 0; i < rowsOut.length; i += 200) {
    const { error } = await supa.from("ranking_rows").insert(rowsOut.slice(i, i + 200));
    if (error) {
      // Mark the run failed so latestRun (which serves only complete runs)
      // never picks a partially-written board.
      await supa.from("ranking_runs").update({ status: "failed" }).eq("id", run.id);
      const hint = /integer/.test(error.message) ? " — run migration 0243 on Soar Hub v2." : "";
      return { error: `Row insert failed: ${error.message}${hint}`, status: 500 };
    }
  }
  // All rows landed — publish the run.
  await supa.from("ranking_runs").update({ status: "complete", completed_at: new Date().toISOString() }).eq("id", run.id);

  return { run_id: run.id, week_ending: weekEnding, period: fi.period, week: fi.weekInPeriod, rows: rowsOut.length, issues };
}

const TIERS = new Set(["store", "do", "sdo", "rvp", "entity", "company"]);

// Completed runs, one per week (newest run wins a re-run week) — the week
// picker's source, mirroring the legacy ranker's week tabs.
export async function listRuns(supa) {
  const { data, error } = await supa
    .from("ranking_runs")
    .select("id, week_ending, period, week, started_at, completed_at")
    .eq("status", "complete")
    .order("week_ending", { ascending: false })
    .order("started_at", { ascending: false })
    .limit(200);
  if (error) {
    if (/ranking_runs/.test(error.message)) return { error: "Run migration 0237 first (ranking tables are missing).", status: 500 };
    return { error: error.message, status: 500 };
  }
  const seen = new Set();
  const runs = [];
  for (const r of data || []) {
    if (seen.has(r.week_ending)) continue;
    seen.add(r.week_ending);
    runs.push(r);
  }
  return { runs };
}

// One run's rows — the latest by default, or a specific run via run_id
// (the week picker's navigation).
export async function latestRun(supa, params) {
  const scope = params.scope === "wtd" ? "wtd" : "ptd";
  const tier = TIERS.has(params.tier) ? params.tier : "store";
  let run = null;
  if (params.run_id) {
    const { data, error } = await supa.from("ranking_runs").select("*").eq("id", params.run_id).maybeSingle();
    if (error) return { error: error.message, status: 500 };
    if (!data) return { error: "Run not found.", status: 404 };
    run = data;
  } else {
    const { data: runs, error } = await supa
      .from("ranking_runs").select("*")
      .eq("status", "complete")
      .order("started_at", { ascending: false }).limit(1);
    if (error) {
      if (/ranking_runs/.test(error.message)) return { error: "Run migration 0237 first (ranking tables are missing).", status: 500 };
      return { error: error.message, status: 500 };
    }
    run = runs?.[0] ?? null;
  }
  if (!run) return { run: null, scope, tier, rows: [] };
  const { data: rows, error: rowsErr } = await supa
    .from("ranking_rows")
    .select("entity_key, store_id, rank, total_points, metrics")
    .eq("run_id", run.id).eq("scope", scope).eq("tier", tier)
    .order("rank", { ascending: true });
  if (rowsErr) return { error: rowsErr.message, status: 500 };
  return { run, scope, tier, rows: rows || [] };
}

// One run's ENTIRE board — every scope and tier, in a single response — for
// the Excel workbook export. Latest complete run, or a specific run_id.
export async function fullRun(supa, params) {
  let run = null;
  if (params.run_id) {
    const { data } = await supa.from("ranking_runs").select("*").eq("id", params.run_id).maybeSingle();
    run = data ?? null;
  } else {
    const { data: runs, error } = await supa
      .from("ranking_runs").select("*").eq("status", "complete")
      .order("started_at", { ascending: false }).limit(1);
    if (error) {
      if (/ranking_runs/.test(error.message)) return { error: "Run migration 0237 first (ranking tables are missing).", status: 500 };
      return { error: error.message, status: 500 };
    }
    run = runs?.[0] ?? null;
  }
  if (!run) return { run: null, scopes: {} };
  const { data: rows, error } = await supa
    .from("ranking_rows")
    .select("scope, tier, entity_key, store_id, rank, total_points, metrics")
    .eq("run_id", run.id)
    .order("rank", { ascending: true })
    .limit(5000);
  if (error) return { error: error.message, status: 500 };
  const scopes = { ptd: {}, wtd: {} };
  for (const r of rows || []) {
    const s = r.scope === "wtd" ? "wtd" : "ptd";
    (scopes[s][r.tier] ||= []).push({ entity_key: r.entity_key, rank: r.rank, total_points: r.total_points, metrics: r.metrics });
  }
  return { run, scopes };
}
