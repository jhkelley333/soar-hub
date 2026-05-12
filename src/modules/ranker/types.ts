// Ranker — shared type definitions. Mirrors the JSON shapes the
// netlify functions return so views can render directly without a
// transform layer.

export type MetricKey =
  | "storeRank"
  | "storeNum"
  | "storeName"
  | "gmName"
  | "annualizedFinancialMiss"
  | "weeklySales"
  | "vsLastYear"
  | "cogsEff"
  | "annualizedFcMiss"
  | "laborPct"
  | "varToChart"
  | "bscTraining"
  | "onTimeTickets"
  | "vogWeek"
  | "vogCount"
  | "complaints"
  | "callsPer10k";

export type MetricValue = number | string | null;
export type Metrics = Record<MetricKey, MetricValue>;

export interface RankMovement {
  currentRank: number;
  lastRank: number;
  change: number;
}

export interface Momentum {
  sales: "Improving" | "Softening" | "Stable";
  labor: "Improving" | "Rising" | "Stable";
  guest: "Improving" | "Softening" | "Stable";
}

export interface Trends {
  weeks: string[];
  seriesByMetric: Partial<Record<MetricKey, (number | null)[]>>;
}

export interface PeerCandidate {
  store: string;
  storeName: string;
  gmName: string;
  weeklySales: number;
  salesGapAbs: number;
}

export interface PortfolioRow {
  store: string;
  storeName: string;
  gmName: string;
  storeRank: number | null;
  weeklySales: number | null;
  vsLastYear: number | null;
  laborPct: number | null;
  vogWeek: number | null;
  vogCount: number | null;
  complaints: number | null;
  callsPer10k: number | null;
  varToChart: number | null;
  rankChange: number | null;
}

export interface InitResponse {
  ok: true;
  currentWeek: number | null;
  availableWeeks: number[];
  allStores: string[];
}

export interface StoreDashboardResponse {
  ok: true;
  found: boolean;
  store: string;
  week: string;
  trendWeeks?: number;
  metrics?: Metrics;
  priorMetrics?: Metrics | null;
  rankMovement?: RankMovement | null;
  trends?: Trends;
  peerCandidates?: PeerCandidate[];
  selectedPeerStore?: string;
  peer?: { store: string; metrics: Metrics } | null;
  executionScore?: number | null;
  momentum?: Momentum;
}

export interface WarRoomResponse {
  ok: true;
  week: string;
  storeCount: number;
  avgWeeklySales: number | null;
  avgLaborPct: number | null;
  avgRank: number | null;
  avgVogCount: number | null;
  topSales: PortfolioRow[];
  topImprovers: {
    store: string;
    storeName: string;
    currentRank: number | null;
    rankChange: number;
  }[];
  rankDecliners: {
    store: string;
    storeName: string;
    currentRank: number | null;
    rankChange: number;
  }[];
  coachingPriorities: {
    store: string;
    storeName: string;
    priority: "HIGH" | "MED" | "LOW";
    issues: string;
  }[];
  recognition: { store: string; storeName: string; wins: string }[];
  portfolioRows: PortfolioRow[];
}

export interface AISummaryResponse {
  ok: true;
  summary: string;
  cached: boolean;
  generatedAt: string;
  model: string | null;
}

export type Tone = "good" | "warn" | "bad";
