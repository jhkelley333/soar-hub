// Ranker — value-formatting helpers. Mirrors the legacy command-center
// HTML's number/percent/currency rules so the UI behaves identically on
// data shapes that come back as strings vs numbers.

import type { MetricKey, MetricValue, RankMovement, Tone } from "./types";

const MONEY_KEYS = new Set<MetricKey>([
  "weeklySales",
  "annualizedFinancialMiss",
  "annualizedFcMiss",
]);

const PCT_KEYS = new Set<MetricKey>([
  "vsLastYear",
  "cogsEff",
  "laborPct",
  "bscTraining",
  "onTimeTickets",
  "vogWeek",
]);

const INT_KEYS = new Set<MetricKey>([
  "storeRank",
  "vogCount",
  "complaints",
  "callsPer10k",
]);

// "Lower is better" for these — a smaller value is a positive delta.
const LOWER_BETTER = new Set<MetricKey>([
  "laborPct",
  "complaints",
  "callsPer10k",
  "storeRank",
]);

export function num(v: MetricValue): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[$,%]/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

export function money(v: MetricValue): string {
  if (v === null || v === undefined || v === "") return "—";
  const s = String(v).trim();
  if (s.includes("$")) return s;
  const n = num(v);
  if (n === null) return s;
  return (
    "$" +
    n.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
  );
}

export function pct(v: MetricValue): string {
  if (v === null || v === undefined || v === "") return "—";
  const s = String(v).trim();
  if (s.includes("%")) return s;
  const n = num(v);
  if (n === null) return s;
  const val = Math.abs(n) > 0 && Math.abs(n) <= 1 ? n * 100 : n;
  return Math.round(val * 100) / 100 + "%";
}

export function integer(v: MetricValue): string {
  const n = num(v);
  if (n === null) return "—";
  return String(Math.round(n));
}

export function fmtMetric(key: MetricKey, value: MetricValue): string {
  if (MONEY_KEYS.has(key)) return money(value);
  if (PCT_KEYS.has(key)) return pct(value);
  if (INT_KEYS.has(key)) return integer(value);
  if (key === "varToChart") {
    const n = num(value);
    if (n === null) return "—";
    // Heuristic: variance values ≤ 1 read as percent, otherwise dollar.
    return Math.abs(n) < 1 ? pct(value) : money(value);
  }
  return value == null || value === "" ? "—" : String(value);
}

export function deltaClass(
  key: MetricKey,
  cur: MetricValue,
  prior: MetricValue,
): Tone {
  const c = num(cur);
  const p = num(prior);
  if (c === null || p === null || c === p) return "warn";
  const lowerBetter = LOWER_BETTER.has(key);
  if (lowerBetter) return c < p ? "good" : "bad";
  return c > p ? "good" : "bad";
}

export function deltaText(
  key: MetricKey,
  cur: MetricValue,
  prior: MetricValue,
): string {
  const c = num(cur);
  const p = num(prior);
  if (c === null || p === null) return "No prior data";
  if (MONEY_KEYS.has(key)) {
    const d = c - p;
    return (d > 0 ? "+" : "") + money(d) + " vs LW";
  }
  if (PCT_KEYS.has(key)) {
    const dp = Math.abs(c) <= 1 && Math.abs(p) <= 1 ? (c - p) * 100 : c - p;
    return (dp > 0 ? "+" : "") + Math.round(dp * 100) / 100 + " pts vs LW";
  }
  const diff = c - p;
  return (diff > 0 ? "+" : "") + Math.round(diff * 100) / 100 + " vs LW";
}

export function rankDelta(rm: RankMovement | null | undefined): {
  text: string;
  tone: Tone;
} {
  if (!rm) return { text: "No prior week", tone: "warn" };
  if (rm.change === 0) return { text: "No change vs LW", tone: "warn" };
  if (rm.change > 0) return { text: `▲ ${rm.change} vs LW`, tone: "bad" };
  return { text: `▼ ${Math.abs(rm.change)} vs LW`, tone: "good" };
}

// Tone → Tailwind text-color utility. Centralized so a future palette
// shift only touches this map.
export function toneTextClass(tone: Tone): string {
  return tone === "good"
    ? "text-emerald-600"
    : tone === "bad"
      ? "text-red-600"
      : "text-amber-600";
}
