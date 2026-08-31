/**
 * Data contract for the Ranker executive-summary export.
 *
 * These field names mirror the ranking workbook column headers so the mapping
 * from the existing ranker payload is a rename, not a transform. If the Ranker
 * page already holds rows in a different shape, write an adapter in
 * `adaptRankerRows.ts` rather than changing these names.
 */

export interface RankedStore {
  rank: number;
  storeNumber: string;
  location: string;
  gm: string;
  totalPoints: number;

  // Sales
  sales: number;
  lySales: number;
  pctVsLy: number | null;
  tickets: number;
  lyTickets: number;
  ticketsVsLyPct: number | null;
  salesScore: number;

  // Food cost
  cogsEffPct: number | null;
  fcDollarMiss: number;
  fcAnnualized: number;
  fcScore: number;

  // Labor
  laborPct: number | null;
  ptoPct: number | null;
  chart: number | null;
  varToChart: number | null;
  laborDollarMiss: number;
  hoursOver: number;
  laborAnnualized: number;
  laborScore: number;

  // Financial rollup (salesScore + fcScore + laborScore)
  finDollarMiss: number;
  finAnnualized: number;
  finScore: number;

  // Operations
  bscTrainingPct: number | null;
  bscScore: number;
  onTimePct: number | null;
  onTimeScore: number;
  callsPer10kTickets: number | null;
  complaintsScore: number;
  /** Numeric percent, or the literal string 'No Audit'. */
  ecoSure: number | 'No Audit' | null;
  ecoSureScore: number;
  vog: number | null;
  vogScore: number;
  trainingPct: number | null;
  trainingScore: number;
  shops: number;
  shopAvg: number;
  opsScore: number;

  // Info only — tracked, not scored
  voidsDollars: number;
  voidsPct: number | null;
  doh: number | null;
  endingDollars: number | null;
  dollarsOverGoal: number;
  cashOverShortWtd: number;
  paidOutsWtd: number;
}

/** The Company line at the bottom of the ranking sheet. */
export interface CompanyLine {
  name: string;
  stores: number;
  totalPoints: number;
  sales: number;
  lySales: number;
  pctVsLy: number;
  tickets: number;
  lyTickets: number;
}

/** One row from the RVPs / SDOs / Directors of Operations / Entities blocks. */
export interface LeaderRollup {
  level: 'RVP' | 'SDO' | 'DO' | 'Entity';
  name: string;
  rank: number;
  stores: number;
  totalPoints: number;
  sales: number;
  lySales: number;
  pctVsLy: number;
  tickets: number;
  lyTickets: number;
}

/** Everything the exporter needs. Assemble this on the Ranker page. */
export interface RankerRunPayload {
  runId: string;
  periodLabel: string;        // 'Period 9, Week 1'
  weekEndingISO: string;      // '2026-08-30'
  generatedAtISO: string;     // run completion timestamp
  storeCount: number;

  ptd: {
    stores: RankedStore[];
    company: CompanyLine;
    leaders: LeaderRollup[];
  };
  wtd: {
    stores: RankedStore[];
    company: CompanyLine;
    leaders: LeaderRollup[];
  };

  /** One entry per generated packet. Drives page 2. */
  sends: PacketSend[];
}

export interface PacketSend {
  recipient: string;
  level: 'RVP' | 'SDO';
  stores: number;
  ptdRank: number;
  ptdPoints: number;
  wtdRank: number;
  wtdPoints: number;
  sales: number;
  pctVsLy: number;
  ticketsVsLyPct: number;
  /** Section names inside the packet, e.g. ['SDOs', 'DOs', 'Stores']. */
  contents: string[];
}
