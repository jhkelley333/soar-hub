// Ranker metric catalog for Period Commitments. Mirrors the Comms Board / Ranker
// metric set (src/modules/ranking/RankingCommsBoardView.tsx) so an RVP can anchor
// a commitment to ANY metric the Ranker tracks. Kept as a static catalog here;
// the later auto-baseline pass fills baseline_value from live ranking data by
// metric_key. Units are display suffixes only — an RVP types human-readable
// numbers (96.1 for a 96.1% metric), and % gaps are also shown in basis points.

export type MetricDirection = "higher" | "lower" | "target";

export interface RankerMetric {
  key: string;
  label: string;
  goal: string;
  unit: string; // display suffix: '%', '$', 'days', 'pts', '/10K', ''
  direction: MetricDirection; // higher = up is good, lower = down is good, target = hit a band
}

export interface MetricGroup {
  group: string;
  metrics: RankerMetric[];
}

export const METRIC_GROUPS: MetricGroup[] = [
  {
    group: "Sales & Traffic",
    metrics: [
      { key: "pctVsLy", label: "Sales +/- % vs. LY", goal: "5% increase", unit: "%", direction: "higher" },
      { key: "ticketsVsLyPct", label: "Ticket Count % vs. LY", goal: "5% increase", unit: "%", direction: "higher" },
      { key: "eveningPct", label: "Night Time Biz (8PM–Close)", goal: "8%", unit: "%", direction: "higher" },
    ],
  },
  {
    group: "Labor & Cost",
    metrics: [
      { key: "varianceToChart", label: "Labor Variance +/- %", goal: "0% to Chart", unit: "%", direction: "lower" },
      { key: "cogsEff", label: "COGS Efficiency %", goal: "96%–101%", unit: "%", direction: "target" },
      { key: "doh", label: "Inventory – Days on Hand", goal: "7 or 10 days", unit: "days", direction: "lower" },
      { key: "cashOverShort", label: "Cash +/-", goal: "Zero variance", unit: "$", direction: "target" },
      { key: "trVsTz", label: "TR vs TZ Variance", goal: "Zero variance", unit: "", direction: "target" },
    ],
  },
  {
    group: "Guest Experience",
    metrics: [
      { key: "complaints", label: "# of Complaints", goal: "0", unit: "", direction: "lower" },
      { key: "callsPer10k", label: "Complaints / 10K Tickets", goal: "< 1.3", unit: "/10K", direction: "lower" },
      { key: "onTimePct", label: "On-Time %", goal: "> 80%", unit: "%", direction: "higher" },
      { key: "voidsPct", label: "Voids / Discounts", goal: "Under 1%", unit: "%", direction: "lower" },
      { key: "vog", label: "VOG", goal: "70%", unit: "%", direction: "higher" },
    ],
  },
  {
    group: "Training & BSC",
    metrics: [
      { key: "totalTrainingPct", label: "Station Training %", goal: "100%", unit: "%", direction: "higher" },
      { key: "bscTrainingPct", label: "LTO Training", goal: "95%", unit: "%", direction: "higher" },
      { key: "totalBsc", label: "Total BSC Score", goal: "5.0", unit: "pts", direction: "higher" },
    ],
  },
];

export const METRICS_BY_KEY: Record<string, RankerMetric> = Object.fromEntries(
  METRIC_GROUPS.flatMap((g) => g.metrics).map((m) => [m.key, m]),
);

// The unit an action's expected impact is expressed in. For percentage metrics
// leaders think in basis points (a 0.9pp move = 90 bps), so impact is bps and
// the gap is scaled to match; every other metric uses its own unit.
export function impactUnit(metric: RankerMetric | null | undefined): string {
  if (!metric) return "";
  return metric.unit === "%" ? "bps" : metric.unit;
}

// Signed gap (target − baseline) expressed in impactUnit, or null if either end
// is missing. % metrics are scaled ×100 into basis points.
export function gapInImpactUnit(
  metric: RankerMetric | null | undefined,
  baseline: number | null,
  target: number | null,
): number | null {
  if (baseline == null || target == null || Number.isNaN(baseline) || Number.isNaN(target)) return null;
  const gap = target - baseline;
  return metric?.unit === "%" ? gap * 100 : gap;
}

// Human label for a gap, e.g. "+90 bps", "-1.0 days", "+2 /10K".
export function fmtGap(metric: RankerMetric | null | undefined, gap: number | null): string | null {
  if (gap == null || Number.isNaN(gap)) return null;
  const sign = gap > 0 ? "+" : "";
  const u = impactUnit(metric);
  const decimals = u === "bps" || u === "" || u === "/10K" ? 0 : 1;
  return `${sign}${gap.toFixed(decimals)}${u ? ` ${u}` : ""}`.trim();
}

// Value + display unit, e.g. "96.1%", "$0.00", "7 days".
export function fmtMetricValue(metric: RankerMetric | null | undefined, v: number | null): string | null {
  if (v == null || Number.isNaN(v)) return null;
  if (!metric || !metric.unit) return String(v);
  if (metric.unit === "%") return `${v}%`;
  if (metric.unit === "$") return `$${v}`;
  return `${v} ${metric.unit}`;
}
