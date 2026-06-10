// RollerGame — a hidden endless-runner easter egg. RollerBuddy skates the
// drive-in strip; tap / click / Space to hop over the traffic cones. Speed
// ramps with your score; best score is kept in localStorage. Opened from the
// little red arcade button on the public landing page.
//
// Pure DOM + requestAnimationFrame (no canvas) to match the rest of the app.
// The physics live in a ref; a frame counter forces the re-render each tick.

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { BuddyArt } from "./BuddyArt";

const GROUND_H = 72;     // road band height (px)
const BUDDY_X = 56;      // buddy left offset (px)
const BUDDY_W = 52;
const BUDDY_H = 60;
const GRAVITY = 2600;    // px/s²
const JUMP_V = 880;      // initial up velocity (px/s)
const BASE_SPEED = 300;  // px/s
const HIGH_KEY = "soar.rollerHigh";

const WIPEOUTS = ["Wiped out!", "Eat my dust… next time!", "Skate ya later!", "Tot-ally crashed."];

interface Obstacle { id: number; x: number; w: number; h: number; passed: boolean }
interface World {
  y: number; vy: number; grounded: boolean;
  obstacles: Obstacle[]; speed: number; score: number;
  state: "ready" | "playing" | "over";
  spawnIn: number; last: number; w: number; h: number; nextId: number; wipe: string;
}

export function RollerGame({ onClose }: { onClose: () => void }) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [, setFrame] = useState(0);
  const [high, setHigh] = useState(() => {
    const n = Number(localStorage.getItem(HIGH_KEY));
    return Number.isFinite(n) ? n : 0;
  });
  const world = useRef<World>({
    y: 0, vy: 0, grounded: true, obstacles: [], speed: BASE_SPEED, score: 0,
    state: "ready", spawnIn: 1, last: 0, w: 0, h: 0, nextId: 1, wipe: WIPEOUTS[0],
  });

  function reset() {
    const w = world.current;
    w.y = 0; w.vy = 0; w.grounded = true; w.obstacles = []; w.speed = BASE_SPEED;
    w.score = 0; w.spawnIn = 0.9; w.nextId = 1;
  }
  function jump() {
    const w = world.current;
    if (w.state === "ready") { reset(); w.state = "playing"; return; }
    if (w.state === "over") { reset(); w.state = "playing"; return; }
    if (w.state === "playing" && w.grounded) { w.vy = JUMP_V; w.grounded = false; }
  }

  // Input: tap / click anywhere, Space / ArrowUp to hop, Esc to leave.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") { e.preventDefault(); jump(); }
      else if (e.code === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Game loop.
  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      const w = world.current;
      const el = areaRef.current;
      if (el) { w.w = el.clientWidth; w.h = el.clientHeight; }
      if (!w.last) w.last = now;
      const dt = Math.min(0.05, (now - w.last) / 1000);
      w.last = now;

      if (w.state === "playing") {
        // vertical
        w.vy -= GRAVITY * dt;
        w.y += w.vy * dt;
        if (w.y <= 0) { w.y = 0; w.vy = 0; w.grounded = true; }
        // speed ramps with score
        w.speed = Math.min(760, BASE_SPEED + w.score * 7);
        // move + score + cull
        for (const o of w.obstacles) {
          o.x -= w.speed * dt;
          if (!o.passed && o.x + o.w < BUDDY_X) { o.passed = true; w.score += 1; }
        }
        w.obstacles = w.obstacles.filter((o) => o.x > -o.w - 12);
        // spawn
        w.spawnIn -= dt;
        if (w.spawnIn <= 0) {
          const hh = 34 + Math.round(Math.random() * 42);
          const ww = 22 + Math.round(Math.random() * 14);
          w.obstacles.push({ id: w.nextId++, x: w.w + 10, w: ww, h: hh, passed: false });
          const minGapPx = 240 + Math.random() * 220;
          w.spawnIn = Math.max(minGapPx / w.speed, 0.7 + Math.random() * 0.7);
        }
        // collision (ground-relative): x overlap AND buddy bottom below cone top
        for (const o of w.obstacles) {
          const overlapX = BUDDY_X + BUDDY_W - 8 > o.x && BUDDY_X + 8 < o.x + o.w;
          if (overlapX && w.y < o.h - 8) {
            w.state = "over";
            w.wipe = WIPEOUTS[Math.floor(Math.random() * WIPEOUTS.length)];
            if (w.score > high) { setHigh(w.score); localStorage.setItem(HIGH_KEY, String(w.score)); }
            break;
          }
        }
      }
      setFrame((f) => (f + 1) % 1_000_000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [high]);

  const w = world.current;

  return (
    <div
      className="fixed inset-0 z-[60] select-none overflow-hidden"
      style={{ background: "linear-gradient(180deg,#74D2E7 0%,#A7E3F0 55%,#E8F1F8 100%)" }}
      onPointerDown={jump}
      role="dialog"
      aria-label="RollerBuddy runner game"
    >
      {/* close */}
      <button
        type="button"
        onPointerDown={(e) => { e.stopPropagation(); onClose(); }}
        className="absolute right-4 top-4 z-20 grid h-9 w-9 place-items-center rounded-full bg-white/80 text-midnight shadow hover:bg-white"
        aria-label="Close game"
      >
        <X className="h-5 w-5" strokeWidth={2} />
      </button>

      {/* score */}
      <div className="absolute left-4 top-4 z-20 text-sm font-bold tabular-nums text-midnight">
        Score <span className="text-lg">{w.score}</span>
        <span className="ml-3 text-midnight/60">Best {Math.max(high, w.score)}</span>
      </div>

      {/* drifting clouds for depth */}
      <div aria-hidden className="pointer-events-none absolute left-[12%] top-[18%] h-10 w-24 rounded-full bg-white/70 blur-[1px]" />
      <div aria-hidden className="pointer-events-none absolute left-[58%] top-[12%] h-8 w-20 rounded-full bg-white/60 blur-[1px]" />

      <div ref={areaRef} className="absolute inset-0">
        {/* ground / road */}
        <div className="absolute inset-x-0 bottom-0" style={{ height: GROUND_H, background: "linear-gradient(180deg,#3a4a5c,#26303c)" }}>
          <div className="absolute left-0 right-0 top-2 h-[3px]" style={{
            backgroundImage: "repeating-linear-gradient(90deg,#FFD166 0 28px,transparent 28px 56px)",
          }} />
        </div>

        {/* obstacles — orange traffic cones */}
        {w.obstacles.map((o) => (
          <div key={o.id} className="absolute" style={{ left: o.x, bottom: GROUND_H, width: o.w, height: o.h }}>
            <div style={{
              width: 0, height: 0, margin: "0 auto",
              borderLeft: `${o.w / 2}px solid transparent`,
              borderRight: `${o.w / 2}px solid transparent`,
              borderBottom: `${o.h}px solid #f97316`,
            }} />
            <div className="absolute left-1/2 -translate-x-1/2" style={{ bottom: o.h * 0.28, width: o.w * 0.7, height: 3, background: "rgba(255,255,255,0.85)" }} />
          </div>
        ))}

        {/* buddy */}
        <div
          className="absolute"
          style={{ left: BUDDY_X, bottom: GROUND_H + w.y, width: BUDDY_W, height: BUDDY_H, transform: w.grounded ? "none" : "rotate(-8deg)" }}
        >
          <BuddyArt className="h-full w-full" />
        </div>

        {/* overlays */}
        {w.state !== "playing" && (
          <div className="absolute inset-0 z-10 grid place-items-center px-6 text-center">
            <div className="rounded-2xl bg-white/90 px-6 py-5 shadow-xl ring-1 ring-black/5">
              {w.state === "ready" ? (
                <>
                  <div className="text-lg font-bold text-midnight">Help RollerBuddy skate the strip!</div>
                  <div className="mt-1 text-sm text-midnight/70">Tap, click, or press Space to hop the cones.</div>
                  <div className="mt-4 inline-flex items-center rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white">Tap to start</div>
                </>
              ) : (
                <>
                  <div className="text-xl font-bold text-[oklch(0.55_0.22_25)]">{w.wipe}</div>
                  <div className="mt-1 text-sm text-midnight/80">Score <strong className="tabular-nums">{w.score}</strong> · Best <strong className="tabular-nums">{Math.max(high, w.score)}</strong></div>
                  <div className="mt-4 inline-flex items-center rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white">Tap to play again</div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
