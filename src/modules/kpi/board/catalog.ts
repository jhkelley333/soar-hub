// Execution Metrics Board — static metric catalog (name / unit / decimals /
// higher-is-better / target / signed). Live values are fetched separately and
// merged by id; targets/units live here.
//
// Sources, section by section:
//   01 Goals to Grow Sales — Avg Ticket Time (KPI feed), On Time (feed),
//      VOG (ranker), SPLH/Tickets/Avg Check (feed).
//   02 Customer L2R — L2R + Mystery Shop + EcoSure Audit (last-week ranker),
//      Complaints (coming soon).
//   03 Controllable Contribution — Labor % / Actual vs Sched / Over Time (feed).
//   04 COGS Efficiency — COGS Eff (last-week ranker); Daily/Completion/Accuracy
//      scores + Count Variance + Item Efficiency (count feed).
// Unwired / not-yet-populated metrics render "—" (or a "Coming soon" badge).
export type Unit = "" | "%" | "$" | "s" | "min" | "hrs" | "pts" | "rank" | "/10k";
export interface MetricDef {
  id: string;
  name: string;
  unit: Unit;
  dec: number;
  hb: boolean;            // higher is better
  target: number | null;
  // Optional upper bound: when set, the metric is a BAND — good inside
  // [target, targetMax], bad outside (e.g. COGS Eff 96–101%).
  targetMax?: number;
  signed?: boolean;
  soon?: boolean;         // "Coming soon" — no source wired yet, render a badge
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
    key: "sales", index: "01", title: "Goals to Grow Sales", countLabel: "6 execution metrics",
    mtm: { id: "sales_vs_ly", name: "Sales vs. LY", unit: "%", dec: 1, hb: true, target: 4.0, signed: true },
    rows: [
      // Avg Ticket Time comes from the KPI (Skunkworks) feed's averageTicketTime.
      { id: "avg_ticket_time", name: "Avg Ticket Time", unit: "s", dec: 0, hb: false, target: 180 },
      { id: "on_time", name: "On Time", unit: "%", dec: 1, hb: true, target: 92 },
      // VOG pulls from the current ranker (0-1 top-box → shown as %); ranker goal is 70%.
      { id: "vog", name: "VOG", unit: "%", dec: 1, hb: true, target: 70 },
      { id: "splh", name: "SPLH", unit: "$", dec: 2, hb: true, target: 70 },
      { id: "tickets", name: "Tickets", unit: "", dec: 0, hb: true, target: null },
      { id: "average_check", name: "Average Check", unit: "$", dec: 2, hb: true, target: 14.75 },
    ],
  },
  {
    key: "l2r", index: "02", title: "Customer L2R", countLabel: "3 execution metrics",
    // L2R (Likely to Return) from the last-week ranker — the same top-box VOG.
    mtm: { id: "l2r", name: "Likely to Return (L2R)", unit: "%", dec: 1, hb: true, target: 80 },
    rows: [
      { id: "complaints", name: "Complaints", unit: "/10k", dec: 0, hb: false, target: 10, soon: true },
      // Mystery Shop (Shop avg) + EcoSure Audit from the last-week ranker run.
      { id: "mystery_shop_rank", name: "Mystery Shop", unit: "%", dec: 1, hb: true, target: 90 },
      { id: "ecosure_rank", name: "EcoSure Audit", unit: "%", dec: 1, hb: true, target: 95 },
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
  {
    key: "cogs", index: "04", title: "COGS Efficiency", countLabel: "5 execution metrics",
    // COGS Eff headline comes from the last-week ranker (cogsEff); the count
    // scores + variance + item efficiency come from the count feed.
    mtm: { id: "cogs_pct", name: "COGS Eff", unit: "%", dec: 1, hb: true, target: 96, targetMax: 101 },
    rows: [
      { id: "daily_score", name: "Daily Score", unit: "pts", dec: 0, hb: true, target: 95 },
      { id: "completion_score", name: "Completion Score", unit: "%", dec: 0, hb: true, target: 95 },
      { id: "accuracy_score", name: "Accuracy Score", unit: "%", dec: 0, hb: true, target: 95 },
      { id: "count_variance", name: "Daily Count Variance", unit: "$", dec: 0, hb: false, target: 100 },
      { id: "item_efficiency", name: "Item Efficiency", unit: "%", dec: 1, hb: true, target: 98 },
    ],
  },
  {
    key: "other", index: "05", title: "Other Controllable Contribution", countLabel: "2 execution metrics",
    // MTM = combined controllable cost %: Food Cost % (IX / LW ranker) + PTD
    // Labor % (daily) + Cash-Short % (short raises it). Cash Over/Short + Paid
    // Outs (rows) come live from the KPI feed (0279).
    mtm: { id: "other_pct", name: "Controllable Cost % of Sales", unit: "%", dec: 1, hb: false, target: null },
    rows: [
      { id: "cash_over_short", name: "Cash Over / Short", unit: "$", dec: 2, hb: true, target: 0, signed: true },
      { id: "paid_outs", name: "Paid Outs", unit: "$", dec: 0, hb: false, target: 75 },
    ],
  },
];
