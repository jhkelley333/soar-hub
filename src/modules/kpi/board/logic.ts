// Execution Metrics Board — computed-value logic, ported verbatim from the
// design's DCLogic class (fmt / delta / status / spark / metric), extended to
// handle null values (unwired metrics render a skeleton).
import { C, type MetricDef } from "./catalog";
import type { MetricValues, ValPair } from "./api";

export type Period = "daily" | "wtd" | "mtd";

export function fmt(v: number, m: MetricDef): string {
  const n = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: m.dec, maximumFractionDigits: m.dec });
  const sign = v < 0 ? "-" : m.signed && v > 0 ? "+" : "";
  switch (m.unit) {
    case "$": return `${sign}$${n}`;
    case "rank": return `#${n}`;
    case "%": return `${sign}${n}%`;
    case "s": return `${n}s`;
    case "min": return `${n}m`;
    case "hrs": return `${sign}${n} hr`;
    case "/10k": return n;
    case "pts": return `${sign}${n}`;
    default: return `${sign}${n}`;
  }
}

export function delta(m: MetricDef, cur: number, prior: number): { text: string; color: string } {
  const d = cur - prior;
  const good = m.hb ? d > 0 : d < 0;
  const flat = Math.abs(d) < (m.dec ? Math.pow(10, -m.dec) / 2 : 0.5);
  const arrow = flat ? "→" : d > 0 ? "▲" : "▼";
  const mag = Math.abs(d).toLocaleString("en-US", { minimumFractionDigits: m.dec, maximumFractionDigits: m.dec });
  const suffix = m.unit === "%" ? " pp" : "";
  const text = `${arrow} ${m.unit === "$" ? "$" : ""}${mag}${suffix}`;
  return { text, color: flat ? C.dim : good ? C.good : C.bad };
}

export function status(m: MetricDef, cur: number): string {
  if (m.target === null || m.target === undefined) return C.dim;
  if (m.hb) {
    if (cur >= m.target) return C.good;
    return cur >= m.target * 0.95 ? C.accent : C.bad;
  }
  if (m.target === 0) {
    const a = Math.abs(cur);
    return a <= 5 ? C.good : a <= 20 ? C.accent : C.bad;
  }
  if (cur <= m.target) return C.good;
  return cur <= m.target * 1.05 ? C.accent : C.bad;
}

export function targetLabel(m: MetricDef): string {
  if (m.target === null || m.target === undefined) return "no target";
  return `target ${fmt(m.target, { ...m, signed: false })}`;
}

export function spark(vals: number[], w: number, h: number): { d: string; x: string; y: string } {
  const p = 3, mn = Math.min(...vals), mx = Math.max(...vals), r = mx - mn || 1;
  const pts = vals.map((v, i) => [p + (i * (w - 2 * p)) / (vals.length - 1), h - p - ((v - mn) / r) * (h - 2 * p)]);
  return {
    d: pts.map((q, i) => `${i ? "L" : "M"}${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(" "),
    x: pts[pts.length - 1][0].toFixed(1),
    y: pts[pts.length - 1][1].toFixed(1),
  };
}

export interface MetricView {
  name: string;
  hasData: boolean;
  value: string;
  delta: string;
  deltaColor: string;
  targetLabel: string;
  statusColor: string;
  spark: string | null;
  dotX: string;
  dotY: string;
  sparkColor: string;
  weeks: { label: string; value: string }[];
  onTarget: boolean;
}

// Merge a static def with its live values for the selected period.
export function metricView(def: MetricDef, vals: MetricValues | undefined, per: Period, w: number, h: number): MetricView {
  const pair: ValPair = vals?.[per] ?? [null, null];
  const cur = pair[0];
  const weeks = (vals?.weeks ?? []).filter((v): v is number => typeof v === "number");
  if (cur == null) {
    return {
      name: def.name, hasData: false, value: "—", delta: "", deltaColor: C.dim,
      targetLabel: targetLabel(def), statusColor: C.dim, spark: null, dotX: "", dotY: "",
      sparkColor: C.sparkNone, weeks: [], onTarget: false,
    };
  }
  const prior = pair[1];
  const d = prior == null ? { text: "", color: C.dim } : delta(def, cur, prior);
  const st = status(def, cur);
  const sp = weeks.length >= 2 ? spark(weeks, w, h) : null;
  return {
    name: def.name, hasData: true, value: fmt(cur, def), delta: d.text, deltaColor: d.color,
    targetLabel: targetLabel(def), statusColor: st,
    spark: sp?.d ?? null, dotX: sp?.x ?? "", dotY: sp?.y ?? "",
    sparkColor: st === C.dim ? C.sparkNone : st,
    weeks: weeks.map((v, i) => ({ label: i === weeks.length - 1 ? "Now" : `W-${weeks.length - 1 - i}`, value: fmt(v, def) })),
    onTarget: st === C.good,
  };
}

export const PERIOD_LABELS: Record<Period, { label: string; compare: string }> = {
  daily: { label: "Today", compare: "Yesterday" },
  wtd: { label: "Week to date", compare: "Same period last week" },
  mtd: { label: "Month to date", compare: "Same period last month" },
};
