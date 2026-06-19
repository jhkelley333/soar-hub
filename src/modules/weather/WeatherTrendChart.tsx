// Dependency-free SVG trend chart for weather history: daily highs + lows over
// a date range. Responsive (viewBox), with min/max gridlines and end labels.
import { useMemo } from "react";
import type { WeatherHistoryPoint } from "@/modules/dashboard/weatherApi";

const W = 720;
const H = 220;
const PAD = { top: 12, right: 44, bottom: 22, left: 8 };

export function WeatherTrendChart({ points }: { points: WeatherHistoryPoint[] }) {
  const data = useMemo(() => points.filter((p) => p.hi_f != null || p.lo_f != null), [points]);

  const geom = useMemo(() => {
    if (data.length < 2) return null;
    const temps = data.flatMap((p) => [p.hi_f, p.lo_f].filter((v): v is number => v != null));
    let min = Math.min(...temps), max = Math.max(...temps);
    const padT = Math.max(4, (max - min) * 0.1);
    min = Math.floor(min - padT); max = Math.ceil(max + padT);
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (i / (data.length - 1)) * innerW;
    const y = (t: number) => PAD.top + (1 - (t - min) / (max - min || 1)) * innerH;
    const line = (key: "hi_f" | "lo_f") =>
      data
        .map((p, i) => (p[key] == null ? null : `${x(i)},${y(p[key] as number)}`))
        .filter(Boolean)
        .join(" ");
    return { min, max, x, y, hi: line("hi_f"), lo: line("lo_f") };
  }, [data]);

  if (!geom) {
    return <div className="grid h-40 place-items-center text-sm text-zinc-400">Not enough history to chart yet — run a backfill or wait for more pulls.</div>;
  }

  const last = data[data.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Weather trend">
      {/* gridlines + axis labels (min/mid/max) */}
      {[geom.max, Math.round((geom.max + geom.min) / 2), geom.min].map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={geom.y(t)} y2={geom.y(t)} stroke="#f1f1f4" strokeWidth={1} />
          <text x={W - PAD.right + 6} y={geom.y(t) + 4} className="fill-zinc-400 text-[11px]">{Math.round(t)}°</text>
        </g>
      ))}
      {/* lows then highs */}
      <polyline points={geom.lo} fill="none" stroke="#3b82f6" strokeWidth={2} strokeLinejoin="round" />
      <polyline points={geom.hi} fill="none" stroke="#ef4444" strokeWidth={2} strokeLinejoin="round" />
      {/* end value labels */}
      {last.hi_f != null && <circle cx={geom.x(data.length - 1)} cy={geom.y(last.hi_f)} r={3} fill="#ef4444" />}
      {last.lo_f != null && <circle cx={geom.x(data.length - 1)} cy={geom.y(last.lo_f)} r={3} fill="#3b82f6" />}
      {/* date range */}
      <text x={PAD.left} y={H - 6} className="fill-zinc-400 text-[11px]">{data[0].date}</text>
      <text x={W - PAD.right} y={H - 6} textAnchor="end" className="fill-zinc-400 text-[11px]">{last.date}</text>
    </svg>
  );
}
