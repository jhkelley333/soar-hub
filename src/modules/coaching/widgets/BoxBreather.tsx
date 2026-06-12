// Box-breathing widget: Inhale 4 → Hold 4 → Exhale 4 → Hold 4, repeating.
// A single requestAnimationFrame loop drives a continuous elapsed-ms timer;
// phase, countdown, orb scale, and cycle count are all derived from elapsed.
// Pause accumulates elapsed into a base; reset zeroes it. (Per the handoff:
// only transform/opacity are animated — no layout/paint transitions.)
import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { cn } from "@/lib/cn";

const PHASES = ["Inhale", "Hold", "Exhale", "Hold"] as const;
const SEG = 4000; // ms per phase
const CYCLE = SEG * 4;

// Eased orb scale across the cycle: grows on inhale, full on hold,
// shrinks on exhale, empty on the second hold.
function scaleFor(t: number): number {
  const p = t % CYCLE;
  const seg = Math.floor(p / SEG);
  const f = (p % SEG) / SEG;
  const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * x);
  if (seg === 0) return 0.5 + 0.5 * ease(f);   // inhale 0.5→1
  if (seg === 1) return 1;                       // hold full
  if (seg === 2) return 1 - 0.5 * ease(f);       // exhale 1→0.5
  return 0.5;                                     // hold empty
}

export function BoxBreather({ chip }: { chip: string }) {
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const baseRef = useRef(0);          // accumulated ms while paused
  const startRef = useRef(0);         // performance.now() at last resume
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!running) return;
    startRef.current = performance.now();
    const tick = () => {
      setElapsed(baseRef.current + (performance.now() - startRef.current));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [running]);

  function toggle() {
    if (!running) { setStarted(true); setRunning(true); }
    else { baseRef.current = elapsed; setRunning(false); }
  }
  function reset() {
    setRunning(false); setStarted(false);
    baseRef.current = 0; setElapsed(0);
  }

  const phaseIdx = started ? Math.floor((elapsed % CYCLE) / SEG) : -1;
  const phase = started ? PHASES[phaseIdx] : "Ready";
  const countdown = started ? SEG / 1000 - Math.floor((elapsed % SEG) / 1000) : 4;
  const scale = started ? scaleFor(elapsed) : 0.62;
  const cycles = Math.floor(elapsed / CYCLE);
  const seconds = Math.floor(elapsed / 1000);

  return (
    <div className="flex flex-col items-center py-2">
      {/* stage */}
      <div className="relative my-2 flex h-60 w-60 items-center justify-center">
        <div className="absolute inset-0 rounded-full border border-dashed border-border-strong" />
        <div
          className="flex h-32 w-32 flex-col items-center justify-center rounded-full text-white"
          style={{
            background: `radial-gradient(circle at 38% 32%, color-mix(in srgb, ${chip} 32%, #fff), ${chip})`,
            boxShadow: `0 8px 30px color-mix(in srgb, ${chip} 40%, transparent)`,
            transform: `scale(${scale})`,
            transition: running ? "transform 0.12s linear" : "transform 0.4s ease",
            willChange: "transform",
          }}
        >
          <span className="text-lg font-bold tracking-tight">{phase}</span>
          {started && <span className="mt-0.5 font-mono text-2xl font-bold leading-none">{countdown}</span>}
        </div>
      </div>

      {/* phase chips */}
      <div className="mt-3 flex justify-center gap-2">
        {PHASES.map((p, i) => {
          const on = started && i === phaseIdx;
          return (
            <span key={i} className="rounded-full border px-2.5 py-1.5 font-mono text-[11px] transition"
              style={on
                ? { background: chip, borderColor: chip, color: "#fff" }
                : { borderColor: "var(--color-border)", color: "var(--color-ink-subtle)" }}>
              {p}
            </span>
          );
        })}
      </div>

      {/* controls */}
      <div className="mt-4 flex items-center gap-3">
        <button onClick={toggle}
          className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold text-white shadow-card transition active:scale-95"
          style={{ background: chip }}>
          {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {!started ? "Begin" : running ? "Pause" : "Resume"}
        </button>
        {started && (
          <button onClick={reset}
            className="inline-flex items-center gap-2 rounded-full border border-border-strong bg-surface px-4 py-3 text-sm font-semibold text-ink-muted active:bg-surface-sunk">
            <RotateCcw className="h-4 w-4" /> Reset
          </button>
        )}
      </div>

      {/* meta */}
      <div className="mt-5 flex gap-8">
        <Meta v={cycles} k="Cycles" />
        <Meta v={seconds} k="Seconds" />
      </div>
    </div>
  );
}
function Meta({ v, k }: { v: number; k: string }) {
  return (
    <div className="text-center">
      <div className={cn("text-xl font-bold tabular-nums text-heading")}>{v}</div>
      <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-subtle">{k}</div>
    </div>
  );
}
