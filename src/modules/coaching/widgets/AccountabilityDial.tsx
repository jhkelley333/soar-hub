// The Accountability Dial — a 260×142 SVG semicircle gauge with a needle that
// animates (slight overshoot) to the selected level. Each level glides
// calm→urgent by hue. The selected level's description renders conditionally
// (not a max-height animation), per the prototype's rendering caveat.
import { useState } from "react";
import { cn } from "@/lib/cn";

const LEVELS = [
  { name: "The Mention", desc: "A casual, low-key check-in. You simply name what you noticed — light, in passing." },
  { name: "The Invitation", desc: "A quick, private chat. This time you're a little more serious and invite them to fix it." },
  { name: "The Conversation", desc: "A more serious tone. You're now expressing real urgency about the issue." },
  { name: "The Boundary", desc: "A warning conversation. You lay out the consequences if things don't change." },
  { name: "The Limit", desc: "A sign you'll likely need to part ways — but also one last, clear chance to improve." },
];

// Per-level hue glides 150 (calm green) → 22 (urgent red).
function levelColor(i: number) {
  const hue = 150 - (i / 4) * 128;
  return { c: `oklch(0.58 0.15 ${hue})`, soft: `oklch(0.95 0.04 ${hue})` };
}

const CX = 130, CY = 132, R = 112;
function pointAt(t: number) {
  const a = (180 - t * 180) * (Math.PI / 180);
  return [CX + R * Math.cos(a), CY - R * Math.sin(a)] as const;
}
const [LX, LY] = pointAt(0);
const [RX, RY] = pointAt(1);
const ARC = `M ${LX} ${LY} A ${R} ${R} 0 0 1 ${RX} ${RY}`;

export function AccountabilityDial() {
  const [sel, setSel] = useState(0);
  const deg = -78 + (sel / 4) * 156;
  const cur = levelColor(sel);

  return (
    <div className="flex flex-col items-center py-1">
      <svg viewBox="0 0 260 152" className="w-[260px] max-w-full">
        <defs>
          <linearGradient id="dialgrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="oklch(0.6 0.13 150)" />
            <stop offset="50%" stopColor="oklch(0.62 0.14 80)" />
            <stop offset="100%" stopColor="oklch(0.58 0.16 26)" />
          </linearGradient>
        </defs>
        <path d={ARC} fill="none" stroke="var(--color-surface-sunk)" strokeWidth="14" strokeLinecap="round" />
        <path d={ARC} fill="none" stroke="url(#dialgrad)" strokeWidth="6" strokeLinecap="round" opacity="0.9" />
        {LEVELS.map((_, i) => {
          const [x, y] = pointAt(i / 4);
          const active = i <= sel;
          return (
            <circle key={i} cx={x} cy={y} r={i === sel ? 6 : 4.2}
              fill={active ? levelColor(i).c : "var(--color-border-strong)"} />
          );
        })}
        {/* needle */}
        <g style={{ transform: `rotate(${deg}deg)`, transformOrigin: "130px 132px", transition: "transform 0.55s cubic-bezier(.34,1.3,.5,1)" }}>
          <line x1={CX} y1={CY} x2={CX} y2={36} stroke={cur.c} strokeWidth="4" strokeLinecap="round" />
        </g>
        <circle cx={CX} cy={CY} r="9" fill="var(--color-midnight)" />
        <circle cx={CX} cy={CY} r="3.5" fill="#fff" />
      </svg>

      <div className="mt-1 text-center">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-subtle">Level {sel + 1} of 5</div>
        <div className="mt-0.5 text-xl font-bold tracking-tight" style={{ color: cur.c }}>{LEVELS[sel].name}</div>
      </div>

      <div className="mt-5 flex w-full flex-col gap-2.5">
        {LEVELS.map((lv, i) => {
          const col = levelColor(i);
          const active = i === sel;
          return (
            <button key={i} onClick={() => setSel(i)}
              className={cn("flex items-start gap-3 rounded-xl border bg-surface p-3.5 text-left transition active:scale-[.99]",
                active ? "shadow-card" : "border-border")}
              style={active ? { borderColor: col.c, background: col.soft, transform: "translateX(2px)" } : undefined}>
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
                style={{ background: col.c }}>{i + 1}</span>
              <div className="min-w-0">
                <div className="font-semibold tracking-tight" style={active ? { color: col.c } : { color: "var(--color-heading)" }}>{lv.name}</div>
                {active && <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">{lv.desc}</p>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
