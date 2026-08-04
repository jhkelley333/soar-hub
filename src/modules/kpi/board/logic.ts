// Execution Metrics Board — computed-value logic (fmt / delta / status / spark /
// metric), extended to handle null values (unwired metrics render a skeleton).
// Status and delta are returned as semantic tones ("good"/"warn"/"bad"/"flat")
// so the light-themed board can map them to its own Tailwind classes.
import type { MetricDef } from "./catalog";
import type { MetricValues, ValPair } from "./api";

export type Period = "daily" | "wtd" | "mtd";
export type StatusTone = "good" | "warn" | "bad" | "none";
export type DeltaTone = "good" | "bad" | "flat";

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

export function deltaOf(m: MetricDef, cur: number, prior: number): { text: string; tone: DeltaTone } {
  const d = cur - prior;
  const good = m.hb ? d > 0 : d < 0;
  const flat = Math.abs(d) < (m.dec ? Math.pow(10, -m.dec) / 2 : 0.5);
  const arrow = flat ? "→" : d > 0 ? "▲" : "▼";
  const mag = Math.abs(d).toLocaleString("en-US", { minimumFractionDigits: m.dec, maximumFractionDigits: m.dec });
  const suffix = m.unit === "%" ? " pp" : "";
  const text = `${arrow} ${m.unit === "$" ? "$" : ""}${mag}${suffix}`;
  return { text, tone: flat ? "flat" : good ? "good" : "bad" };
}

export function statusTone(m: MetricDef, cur: number): StatusTone {
  if (m.target === null || m.target === undefined) return "none";
  // Band target (e.g. COGS Eff 96–101%): good inside, bad outside, warn near
  // either edge (within 5% of the band).
  if (typeof m.targetMax === "number") {
    const lo = m.target, hi = m.targetMax;
    if (cur >= lo && cur <= hi) return "good";
    if (cur >= lo * 0.95 && cur <= hi * 1.05) return "warn";
    return "bad";
  }
  if (m.hb) {
    if (cur >= m.target) return "good";
    return cur >= m.target * 0.95 ? "warn" : "bad";
  }
  if (m.target === 0) {
    const a = Math.abs(cur);
    return a <= 5 ? "good" : a <= 20 ? "warn" : "bad";
  }
  if (cur <= m.target) return "good";
  return cur <= m.target * 1.05 ? "warn" : "bad";
}

export function targetLabel(m: MetricDef): string {
  if (m.target === null || m.target === undefined) return "no target";
  const base = { ...m, signed: false };
  if (typeof m.targetMax === "number") {
    // Range — share a single trailing "%" for the common percent case.
    if (m.unit === "%") {
      const n = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: m.dec, maximumFractionDigits: m.dec });
      return `target ${n(m.target)}–${n(m.targetMax)}%`;
    }
    return `target ${fmt(m.target, base)}–${fmt(m.targetMax, base)}`;
  }
  return `target ${fmt(m.target, base)}`;
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
  deltaTone: DeltaTone;
  targetLabel: string;
  statusTone: StatusTone;
  spark: string | null;
  dotX: string;
  dotY: string;
  weeks: { label: string; value: string }[];
  onTarget: boolean;
}

// Merge a static def with its live values for the selected period. An optional
// numeric targetOverride (from the board's targets map) replaces def.target for
// status + label — used for admin-set targets and the data-driven labor target.
export function metricView(def: MetricDef, vals: MetricValues | undefined, per: Period, w: number, h: number, targetOverride?: number | null): MetricView {
  if (typeof targetOverride === "number") def = { ...def, target: targetOverride };
  const pair: ValPair = vals?.[per] ?? [null, null];
  const cur = pair[0];
  const weeks = (vals?.weeks ?? []).filter((v): v is number => typeof v === "number");
  if (cur == null) {
    return {
      name: def.name, hasData: false, value: "—", delta: "", deltaTone: "flat",
      targetLabel: targetLabel(def), statusTone: "none", spark: null, dotX: "", dotY: "",
      weeks: [], onTarget: false,
    };
  }
  const prior = pair[1];
  const d = prior == null ? { text: "", tone: "flat" as DeltaTone } : deltaOf(def, cur, prior);
  const st = statusTone(def, cur);
  const sp = weeks.length >= 2 ? spark(weeks, w, h) : null;
  return {
    name: def.name, hasData: true, value: fmt(cur, def), delta: d.text, deltaTone: d.tone,
    targetLabel: targetLabel(def), statusTone: st,
    spark: sp?.d ?? null, dotX: sp?.x ?? "", dotY: sp?.y ?? "",
    weeks: weeks.map((v, i) => ({ label: i === weeks.length - 1 ? "Now" : `W-${weeks.length - 1 - i}`, value: fmt(v, def) })),
    onTarget: st === "good",
  };
}

export const PERIOD_LABELS: Record<Period, { label: string; compare: string }> = {
  daily: { label: "Today", compare: "Yesterday" },
  wtd: { label: "Week to date", compare: "Same period last week" },
  mtd: { label: "Month to date", compare: "Same period last month" },
};
