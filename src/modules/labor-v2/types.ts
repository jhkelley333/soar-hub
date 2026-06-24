// Labor v2 — types mirroring netlify/functions/labor-v2.js.

export type LaborLevel = "region" | "area" | "district" | "store";

export interface LaborRow {
  name: string;
  storeCount: number;
  number?: string;
  leader?: string | null;
  region?: string | null;
  area?: string | null;
  district?: string | null;
  netSales: number | null;
  laborCost: number | null;
  laborHours: number | null;       // actual hours
  overtimeHours: number | null;
  scheduledHours: number | null;
  actualVsSched: number | null;
  laborPct: number | null;         // fraction
  targetPct: number | null;        // fraction
  variancePts: number | null;      // laborPct - targetPct (fraction; ×100 = points)
  splh: number | null;
}

export interface LaborSummary {
  ok: true;
  date: string | null;
  total: LaborRow | null;
  scope: { matched: number; unmatched: number; unmatchedSample?: string[] };
  levels: Record<LaborLevel, LaborRow[]>;
}
