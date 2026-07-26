// Execution Metrics Board — static metric catalog (name / unit / decimals /
// higher-is-better / target / signed), mirroring the design. Live values are
// fetched separately and merged by id; targets/units live here.
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
  span: number;          // 12-col grid span
  mtmStyle: "panel" | "banner";
  rowStyle: "grid2" | "stack" | "team";
  mtmSize: number;       // MTM value font-size px
  spark: [number, number]; // MTM sparkline viewBox
  countLabel?: string;   // pillar-01 shows "9 execution metrics"
  mtm: MetricDef;
  rows: MetricDef[];
}

export const PILLARS: Pillar[] = [
  {
    key: "sales", index: "01", title: "Goals to Grow Sales", span: 12,
    mtmStyle: "panel", rowStyle: "grid2", mtmSize: 42, spark: [240, 46], countLabel: "9 execution metrics",
    mtm: { id: "sales_vs_ly", name: "Sales vs. LY", unit: "%", dec: 1, hb: true, target: 4.0, signed: true },
    rows: [
      { id: "avg_ticket_time", name: "Avg Ticket Time", unit: "s", dec: 0, hb: false, target: 180 },
      { id: "on_time", name: "On Time", unit: "%", dec: 1, hb: true, target: 92 },
      { id: "vog", name: "VOG", unit: "pts", dec: 2, hb: true, target: 4.7 },
      { id: "complaints", name: "Complaints", unit: "/10k", dec: 0, hb: false, target: 10 },
      { id: "order_accuracy", name: "Order Accuracy (OA)", unit: "%", dec: 1, hb: true, target: 97.5 },
      { id: "delivery_mix", name: "Delivery Mix", unit: "%", dec: 1, hb: true, target: 9 },
      { id: "splh", name: "SPLH", unit: "$", dec: 2, hb: true, target: 70 },
      { id: "tickets", name: "Tickets", unit: "", dec: 0, hb: true, target: null },
      { id: "average_check", name: "Average Check", unit: "$", dec: 2, hb: true, target: 14.75 },
    ],
  },
  {
    key: "l2r", index: "02", title: "Customer L2R", span: 5,
    mtmStyle: "banner", rowStyle: "stack", mtmSize: 36, spark: [160, 44],
    mtm: { id: "l2r", name: "Likely to Return (L2R)", unit: "%", dec: 1, hb: true, target: 80 },
    rows: [
      { id: "vog2", name: "VOG", unit: "pts", dec: 2, hb: true, target: 4.7 },
      { id: "complaints_rank", name: "Complaints Rank", unit: "rank", dec: 0, hb: false, target: 100 },
      { id: "mystery_shop_rank", name: "Mystery Shop Rank", unit: "rank", dec: 0, hb: false, target: 100 },
      { id: "ecosure_rank", name: "EcoSure Audit Rank", unit: "rank", dec: 0, hb: false, target: 100 },
    ],
  },
  {
    key: "labor", index: "03", title: "Controllable Contribution", span: 4,
    mtmStyle: "banner", rowStyle: "stack", mtmSize: 36, spark: [120, 44],
    mtm: { id: "labor_pct", name: "Labor % vs. Target", unit: "%", dec: 1, hb: false, target: 26.0 },
    rows: [
      { id: "actual_vs_schedule", name: "Actual vs. Schedule", unit: "hrs", dec: 1, hb: false, target: 0, signed: true },
      { id: "overtime", name: "Over Time", unit: "hrs", dec: 1, hb: false, target: 4.0 },
    ],
  },
  {
    key: "team", index: "04", title: "Team Member", span: 3,
    mtmStyle: "panel", rowStyle: "team", mtmSize: 36, spark: [200, 40],
    mtm: { id: "training_compliance", name: "Training Compliance", unit: "%", dec: 0, hb: true, target: 95 },
    rows: [
      { id: "new_hire_certified", name: "New Hire Certified", unit: "%", dec: 0, hb: true, target: 90 },
      { id: "cross_trained", name: "Cross-Trained Positions", unit: "", dec: 1, hb: true, target: 4 },
      { id: "ninety_day_retention", name: "90-Day Retention", unit: "%", dec: 0, hb: true, target: 80 },
    ],
  },
  {
    key: "cogs", index: "05", title: "COGS Efficiency", span: 7,
    mtmStyle: "panel", rowStyle: "stack", mtmSize: 38, spark: [232, 42],
    mtm: { id: "cogs_pct", name: "COGS % of Sales", unit: "%", dec: 1, hb: false, target: 29.8 },
    rows: [
      { id: "daily_score", name: "Daily Score", unit: "pts", dec: 0, hb: true, target: 95 },
      { id: "completion_score", name: "Completion Score", unit: "%", dec: 0, hb: true, target: 95 },
      { id: "accuracy_score", name: "Accuracy Score", unit: "%", dec: 0, hb: true, target: 95 },
      { id: "count_variance", name: "Daily Count Variance", unit: "$", dec: 0, hb: false, target: 100 },
      { id: "item_efficiency", name: "Item Efficiency", unit: "%", dec: 1, hb: true, target: 98 },
    ],
  },
  {
    key: "other", index: "06", title: "Other Controllable Contribution", span: 5,
    mtmStyle: "banner", rowStyle: "stack", mtmSize: 36, spark: [160, 44],
    mtm: { id: "other_pct", name: "Other Controllables % of Sales", unit: "%", dec: 1, hb: false, target: 4.0 },
    rows: [
      { id: "cash_over_short", name: "Cash Over / Short", unit: "$", dec: 2, hb: true, target: 0, signed: true },
      { id: "paid_outs", name: "Paid Outs", unit: "$", dec: 0, hb: false, target: 75 },
      { id: "last_clock_out", name: "Last Clock Out", unit: "min", dec: 0, hb: false, target: 15 },
    ],
  },
];

// ── design tokens ────────────────────────────────────────────────────────────
export const C = {
  page: "#171715", card: "#232320", inset: "#1D1D1A",
  borderStrong: "#33332D", borderSubtle: "#2C2C27", divider: "#2F2F2A",
  primary: "#F5F3EE", secondary: "#EDEAE3", tertiary: "#CFCAC0", muted: "#9A968C",
  dim: "#8F8A7E", faint: "#7E7A70", inactive: "#B7B2A8", onAccent: "#1B1B18",
  accent: "#E8B04B", good: "#6BBF74", bad: "#E5766B", sparkNone: "#6E6A62",
};
export const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
export const SANS = "'Instrument Sans', ui-sans-serif, system-ui, sans-serif";
