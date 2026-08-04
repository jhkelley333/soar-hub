// Execution Metrics Board — static metric catalog (name / unit / decimals /
// higher-is-better / target / signed). Live values are fetched separately and
// merged by id; targets/units live here.
//
// Phase 1 scopes the board to the Sales pillar ("Goals to Grow Sales"). Its
// execution metrics: On Time + VOG (from the ranker) + SPLH + Tickets +
// Average Check. Avg Ticket Time, Order Accuracy, Delivery Mix, and Complaints
// were dropped. Other pillars will be re-added in follow-up passes.
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
];
