// Execution Metrics Board — static metric catalog (name / unit / decimals /
// higher-is-better / target / signed). Live values are fetched separately and
// merged by id; targets/units live here.
//
// Sections are being re-added and mapped one at a time:
//   01 Goals to Grow Sales — On Time + VOG (ranker) + SPLH + Tickets + Avg Check
//   02 Customer L2R        — re-added for mapping; metrics/sources TBD
//   03 Controllable Contribution — re-added for mapping; labor metrics wired
// Unwired metrics render "—" until their source is decided + hooked up.
export type Unit = "" | "%" | "$" | "s" | "min" | "hrs" | "pts" | "rank" | "/10k";
export interface MetricDef {
  id: string;
  name: string;
  unit: Unit;
  dec: number;
  hb: boolean;            // higher is better
  target: number | null;
  signed?: boolean;
}
export interface Pillar {
  key: string;
  index: string;         // "01".."06"
  title: string;
  countLabel?: string;   // e.g. "6 execution metrics"
  mtm: MetricDef;        // the Metric That Matters (hero)
  rows: MetricDef[];     // execution metrics
}

export const PILLARS: Pillar[] = [
  {
    key: "sales", index: "01", title: "Goals to Grow Sales", countLabel: "5 execution metrics",
    mtm: { id: "sales_vs_ly", name: "Sales vs. LY", unit: "%", dec: 1, hb: true, target: 4.0, signed: true },
    rows: [
      { id: "on_time", name: "On Time", unit: "%", dec: 1, hb: true, target: 92 },
      // VOG pulls from the current ranker (0-1 top-box → shown as %); ranker goal is 70%.
      { id: "vog", name: "VOG", unit: "%", dec: 1, hb: true, target: 70 },
      { id: "splh", name: "SPLH", unit: "$", dec: 2, hb: true, target: 70 },
      { id: "tickets", name: "Tickets", unit: "", dec: 0, hb: true, target: null },
      { id: "average_check", name: "Average Check", unit: "$", dec: 2, hb: true, target: 14.75 },
    ],
  },
  {
    key: "l2r", index: "02", title: "Customer L2R", countLabel: "4 execution metrics",
    mtm: { id: "l2r", name: "Likely to Return (L2R)", unit: "%", dec: 1, hb: true, target: 80 },
    rows: [
      { id: "vog2", name: "VOG", unit: "%", dec: 1, hb: true, target: 70 },
      { id: "complaints_rank", name: "Complaints Rank", unit: "rank", dec: 0, hb: false, target: 100 },
      { id: "mystery_shop_rank", name: "Mystery Shop Rank", unit: "rank", dec: 0, hb: false, target: 100 },
      { id: "ecosure_rank", name: "EcoSure Audit Rank", unit: "rank", dec: 0, hb: false, target: 100 },
    ],
  },
  {
    key: "labor", index: "03", title: "Controllable Contribution", countLabel: "2 execution metrics",
    mtm: { id: "labor_pct", name: "Labor % vs. Target", unit: "%", dec: 1, hb: false, target: 26.0 },
    rows: [
      { id: "actual_vs_schedule", name: "Actual vs. Schedule", unit: "hrs", dec: 1, hb: false, target: 0, signed: true },
      { id: "overtime", name: "Over Time", unit: "hrs", dec: 1, hb: false, target: 4.0 },
    ],
  },
];
