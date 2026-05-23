// Compact circular score gauge (0–100) used on the approvals queue and the
// region rollup. The ring is tone-coded (green / yellow / red / neutral)
// so the value reads at a glance from across the row, and the center
// number is the precise figure for anyone who looks closer.
//
// SVG is preferred over a div+CSS ring trick so the stroke caps round
// off cleanly at any size, and the drawn arc length stays smooth at
// fractional progress.

import type { Tier } from "./Tier";

type Tone = Tier | "neutral";

const RING_COLOR: Record<Tone, string> = {
  green: "oklch(64% 0.13 155)",
  yellow: "oklch(78% 0.15 80)",
  red: "oklch(60% 0.16 25)",
  neutral: "oklch(44% 0.052 250)",
};

export function ScoreRing({
  value = 0,
  size = 44,
  stroke = 4,
  tone = "neutral",
}: {
  value: number;
  size?: number;
  stroke?: number;
  tone?: Tone;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, value)) / 100) * c;
  const color = RING_COLOR[tone];
  const center = size / 2;
  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={center}
          cy={center}
          r={r}
          stroke="oklch(94% 0.018 250)"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={center}
          cy={center}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${dash} ${c}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
      <span className="absolute text-[12px] font-semibold tabular-nums text-midnight-900">
        {value}
      </span>
    </div>
  );
}
