// Review Trends (Last 60 Days) — dual-axis inline-SVG line chart. Review Count
// on the left axis (blue), Average Rating (1–5) on the right axis (rose). Built
// with SVG to match the app's other charts (no charting dependency).

import { useMemo } from "react";
import type { TrendPoint } from "./api";

const W = 920, H = 260, L = 40, R = 42, T = 16, B = 30;
const plotW = W - L - R, plotH = H - T - B;
const COUNT = "#2f7ed8";  // blue
const RATING = "#e8607a"; // rose

const shortDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export function ReviewTrends({ data }: { data: TrendPoint[] }) {
  const model = useMemo(() => {
    const n = data.length;
    const x = (i: number) => (n <= 1 ? L : L + (i / (n - 1)) * plotW);
    const cMax = Math.max(5, Math.ceil(Math.max(1, ...data.map((d) => d.count)) / 5) * 5);
    const yC = (v: number) => T + plotH * (1 - v / cMax);
    const yR = (v: number) => T + plotH * (1 - (v - 1) / 4);

    const countPts = data.map((d, i) => `${x(i).toFixed(1)},${yC(d.count).toFixed(1)}`).join(" ");
    const ratingPts = data
      .map((d, i) => (d.avg != null ? `${x(i).toFixed(1)},${yR(d.avg).toFixed(1)}` : null))
      .filter(Boolean).join(" ");
    const ratingDots = data.map((d, i) => (d.avg != null ? { cx: x(i), cy: yR(d.avg) } : null)).filter(Boolean) as { cx: number; cy: number }[];

    const countTicks = Array.from({ length: 6 }, (_, k) => (cMax * k) / 5);
    const ratingTicks = [1, 2, 3, 4, 5];
    const xLabels = data.map((d, i) => ({ i, x: x(i), label: shortDate(d.date) })).filter((_, i) => i % 10 === 0 || i === data.length - 1);
    return { x, yC, yR, cMax, countPts, ratingPts, ratingDots, countTicks, ratingTicks, xLabels };
  }, [data]);

  const hasAny = data.some((d) => d.count > 0);

  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-zinc-200">
      <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1">
        <h3 className="text-sm font-bold text-midnight">Review Trends (Last 60 Days)</h3>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-zinc-500"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COUNT }} /> Review Count</span>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-zinc-500"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: RATING }} /> Average Rating</span>
      </div>
      {!hasAny ? (
        <div className="py-12 text-center text-sm text-zinc-400">No reviews in the window yet — this fills in as weekly pulls collect reviews.</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }} role="img" aria-label="Review trends line chart" preserveAspectRatio="xMidYMid meet">
          {/* horizontal gridlines + left (count) axis */}
          {model.countTicks.map((t, k) => (
            <g key={k}>
              <line x1={L} x2={W - R} y1={model.yC(t)} y2={model.yC(t)} stroke="#eef2f6" strokeWidth={1} />
              <text x={L - 6} y={model.yC(t) + 3} textAnchor="end" fontSize={9} fill="#94a3b8">{Math.round(t)}</text>
            </g>
          ))}
          {/* right (rating) axis */}
          {model.ratingTicks.map((t) => (
            <text key={t} x={W - R + 6} y={model.yR(t) + 3} textAnchor="start" fontSize={9} fill="#94a3b8">{t.toFixed(1)}</text>
          ))}
          {/* axis titles */}
          <text x={12} y={T + plotH / 2} fontSize={9} fill="#64748b" transform={`rotate(-90 12 ${T + plotH / 2})`} textAnchor="middle">Review Count</text>
          <text x={W - 8} y={T + plotH / 2} fontSize={9} fill="#64748b" transform={`rotate(90 ${W - 8} ${T + plotH / 2})`} textAnchor="middle">Average Rating</text>
          {/* x labels */}
          {model.xLabels.map((l) => (
            <text key={l.i} x={l.x} y={H - 10} textAnchor="middle" fontSize={8.5} fill="#94a3b8">{l.label}</text>
          ))}
          {/* count line */}
          <polyline points={model.countPts} fill="none" stroke={COUNT} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
          {/* rating line + dots */}
          {model.ratingPts && <polyline points={model.ratingPts} fill="none" stroke={RATING} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />}
          {model.ratingDots.map((d, k) => <circle key={k} cx={d.cx} cy={d.cy} r={1.8} fill={RATING} />)}
        </svg>
      )}
      <p className="mt-1 text-[11px] text-zinc-400">Daily counts + average of reviews collected in the window (rolling sample — grows with each weekly pull).</p>
    </div>
  );
}
