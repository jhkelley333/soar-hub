// Maps the Ranker's full-run payload (fetchRankingFull → { run, scopes }) into
// the export's RankerRunPayload. The handoff assumed the page already held the
// whole run in the export's shape; in this repo the page holds only one
// scope+tier at a time, and the full run (every tier, both scopes) comes from
// fetchRankingFull. So this is a real adapter, not the identity function: it
// renames the engine's metric keys to the contract's, and pulls the Company
// line + leader rollups out of the leader tiers.
//
// `sends` is always [] — this Hub has no ranking-packet distribution feature,
// so there are no packet sends to report (the exec summary is single-page).

import type { RankingRun, RankingResultRow, FullRunScope } from "../api";
import type { RankedStore, CompanyLine, LeaderRollup, RankerRunPayload } from "./types";

const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : v != null && Number.isFinite(Number(v)) ? Number(v) : null;
// Required-number fields (scores, dollar misses) — the engine always emits a
// number; fall back to 0 only if a value is genuinely absent. No rounding or
// clamping (the warnings depend on the raw values).
const num = (v: unknown): number => numOrNull(v) ?? 0;
const str = (v: unknown): string => (v == null ? "" : String(v));

function toRankedStore(r: RankingResultRow): RankedStore {
  const m = r.metrics ?? {};
  const eco = m.ecosure;
  return {
    rank: num(r.rank),
    storeNumber: str(m.store ?? r.entity_key),
    location: str(m.location),
    gm: str(m.gm),
    totalPoints: num(r.total_points ?? m.totalPoints),

    // Sales
    sales: num(m.sales),
    lySales: num(m.lySales),
    pctVsLy: numOrNull(m.pctVsLy),
    tickets: num(m.tickets),
    lyTickets: num(m.lyTickets),
    ticketsVsLyPct: numOrNull(m.ticketsVsLyPct),
    salesScore: num(m.salesScore),

    // Food cost
    cogsEffPct: numOrNull(m.cogsEff),
    fcDollarMiss: num(m.fcMiss),
    fcAnnualized: num(m.fcAnnualized),
    fcScore: num(m.fcScore),

    // Labor
    laborPct: numOrNull(m.laborPct),
    ptoPct: numOrNull(m.ptoPct),
    chart: numOrNull(m.chart),
    varToChart: numOrNull(m.varianceToChart),
    laborDollarMiss: num(m.laborMiss),
    hoursOver: num(m.hoursOver),
    laborAnnualized: num(m.laborAnnualized),
    laborScore: num(m.laborScore),

    // Financial rollup
    finDollarMiss: num(m.finMiss),
    finAnnualized: num(m.finAnnualized),
    finScore: num(m.finScore),

    // Operations
    bscTrainingPct: numOrNull(m.bscTrainingPct),
    bscScore: num(m.bscScore),
    onTimePct: numOrNull(m.onTimePct),
    onTimeScore: num(m.onTimeScore),
    callsPer10kTickets: numOrNull(m.callsPer10k),
    complaintsScore: num(m.complaintsScore),
    ecoSure: eco === "No Audit" ? "No Audit" : numOrNull(eco),
    ecoSureScore: num(m.ecosureScore),
    vog: numOrNull(m.vog),
    vogScore: num(m.vogScore),
    trainingPct: numOrNull(m.totalTrainingPct),
    trainingScore: num(m.totalTrainingScore),
    shops: num(m.msCount),
    shopAvg: num(m.msScore),
    opsScore: num(m.opsScore),

    // Info only
    voidsDollars: num(m.voids),
    voidsPct: numOrNull(m.voidsPct),
    doh: numOrNull(m.doh),
    endingDollars: numOrNull(m.endingDollars),
    dollarsOverGoal: num(m.dollarsOverGoal),
    cashOverShortWtd: num(m.cashOverShort),
    paidOutsWtd: num(m.paidOut),
  };
}

function toCompanyLine(r: RankingResultRow | undefined): CompanyLine {
  const m = r?.metrics ?? {};
  return {
    name: str(m.name ?? "SOAR QSR") || "SOAR QSR",
    stores: num(m.storeCount),
    totalPoints: num(r?.total_points ?? m.totalPoints),
    sales: num(m.sales),
    lySales: num(m.lySales),
    pctVsLy: num(m.pctVsLy),
    tickets: num(m.tickets),
    lyTickets: num(m.lyTickets),
  };
}

function toLeaderRollups(scope: FullRunScope): LeaderRollup[] {
  const levels: Array<[LeaderRollup["level"], RankingResultRow[] | undefined]> = [
    ["RVP", scope.rvp],
    ["SDO", scope.sdo],
    ["DO", scope.do],
    ["Entity", scope.entity],
  ];
  const out: LeaderRollup[] = [];
  for (const [level, rows] of levels) {
    for (const r of rows ?? []) {
      const m = r.metrics ?? {};
      out.push({
        level,
        name: str(m.name ?? r.entity_key),
        rank: num(r.rank),
        stores: num(m.storeCount),
        totalPoints: num(r.total_points ?? m.totalPoints),
        sales: num(m.sales),
        lySales: num(m.lySales),
        pctVsLy: num(m.pctVsLy),
        tickets: num(m.tickets),
        lyTickets: num(m.lyTickets),
      });
    }
  }
  return out;
}

function adaptScope(scope: FullRunScope) {
  return {
    stores: (scope.store ?? []).map(toRankedStore),
    company: toCompanyLine((scope.company ?? [])[0]),
    leaders: toLeaderRollups(scope),
  };
}

export function adaptFullRun(full: { run: RankingRun | null; scopes: { ptd: FullRunScope; wtd: FullRunScope } }): RankerRunPayload {
  const run = full.run;
  if (!run) throw new Error("No run to export.");
  const ptd = adaptScope(full.scopes.ptd);
  const wtd = adaptScope(full.scopes.wtd);
  return {
    runId: run.id,
    periodLabel: `Period ${run.period}, Week ${run.week}`,
    weekEndingISO: run.week_ending,
    generatedAtISO: run.completed_at ?? run.started_at ?? new Date().toISOString(),
    storeCount: ptd.stores.length || num(run.source_status?.skunkworks?.stores),
    ptd,
    wtd,
    sends: [], // no ranking-packet feature in this Hub — single-page summary
  };
}
