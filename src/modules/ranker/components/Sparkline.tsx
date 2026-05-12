// Ranker — inline sparkline. Renders a small SVG path over a series of
// values. Null entries become gaps. Caller passes a Tone to drive the
// stroke color via currentColor.

import type { Tone } from "../types";
import { toneTextClass } from "../format";

interface Props {
  values: (number | null)[];
  tone: Tone;
  width?: number;
  height?: number;
}

export function Sparkline({
  values,
  tone,
  width = 160,
  height = 36,
}: Props) {
  const pad = 4;
  const valid = values
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => p.v !== null);
  if (valid.length < 2) return null;

  const nums = valid.map((p) => p.v);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = Math.max(max - min, 1);
  const xStep = (width - pad * 2) / Math.max(values.length - 1, 1);

  const pts: [number, number][] = [];
  for (const p of valid) {
    const x = pad + p.i * xStep;
    const y = height - pad - ((p.v - min) / span) * (height - pad * 2);
    pts.push([x, y]);
  }
  const path = pts
    .map((pt, idx) => `${idx === 0 ? "M" : "L"} ${pt[0]} ${pt[1]}`)
    .join(" ");
  const last = pts[pts.length - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={`h-9 w-full ${toneTextClass(tone)}`}
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last[0]} cy={last[1]} r={3} fill="currentColor" />
    </svg>
  );
}
