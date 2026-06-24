// Labor v2 — types mirroring netlify/functions/labor-v2.js.

export type LaborLevel = "region" | "area" | "district" | "store";

// One period's aggregate (Daily / WTD / PTD) for an org node.
export interface LaborBandAgg {
  sales: number | null;
  laborPct: number | null;         // fraction
  targetPct: number | null;        // fraction
  variancePts: number | null;      // laborPct - targetPct (fraction; ×100 = points)
  dollarsOver: number | null;      // labor cost − chart $ allowed
  hoursOver: number | null;        // $ over ÷ blended avg wage
  chartAllowed: number | null;     // sales × target
  laborHours: number | null;       // actual hours
  scheduledHours: number | null;
  overtimeHours: number | null;
  actualVsSched: number | null;    // act − sched hours
}

export type LaborPeriod = "day" | "wtd" | "ptd";

export interface LaborRow {
  name: string;
  storeCount: number;
  number?: string;
  leader?: string | null;
  region?: string | null;
  area?: string | null;
  district?: string | null;
  netSales: number | null;         // daily sales (default sort)
  day: LaborBandAgg;
  wtd: LaborBandAgg;
  ptd: LaborBandAgg;
}

export interface LaborSummary {
  ok: true;
  date: string | null;
  total: LaborRow | null;
  // Present only on a refresh: how many feed rows carried each band, plus the
  // feed's rawData section names (for diagnosing an empty WTD/PTD).
  refreshed?: { stores: number; wtd: number; ptd: number; feedKeys?: string[] } | null;
  scope: { matched: number; unmatched: number; unmatchedSample?: string[] };
  levels: Record<LaborLevel, LaborRow[]>;
}

// ── Leadership "Team labor" rollup (scoped to the caller's org) ───────
export type TeamLevel = "region" | "area" | "district";
export type TeamStatus = "on" | "over" | "unknown" | "missing";

export interface TeamBand {
  labor_pct: number | null;        // percent points (e.g. 23.7)
  target_pct: number | null;
  variance_pts: number | null;
  dollars_over_chart: number | null;
  hours_over_chart: number | null;
  status: TeamStatus;
}

export interface TeamGroup {
  name: string;
  leader: string | null;
  storeCount: number;
  day: TeamBand;
  wtd: TeamBand;
  ptd: TeamBand;
  storesOver: number;
  notesDue: number;
}

export interface TeamStore {
  store_number: string;
  store_name: string;
  gm_name: string | null;
  do_name: string | null;
  day: TeamBand;
  wtd: TeamBand;
  ptd: TeamBand;
  status: TeamStatus;
  note_due: boolean;
  explained: boolean;
  note: string | null;
}

export interface TeamLaborResponse {
  ok: true;
  date: string | null;
  level: TeamLevel;
  scope: { stores: number; dos: string[] };
  totals: {
    day: TeamBand;
    wtd: TeamBand;
    ptd: TeamBand;
    storesOver: number;
    notesDue: number;
    notesExplained: number;
  } | null;
  nodes: string[];
  groups: TeamGroup[];
  stores: TeamStore[];
}
