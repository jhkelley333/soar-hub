// RollerGame — a hidden endless-runner easter egg. Your skater hops the traffic
// cones on the drive-in strip; tap / click / Space to jump. Speed ramps with the
// score. Pick a character (RollerBuddy or Tot), enter a name, and your best run
// posts to a shared leaderboard. Opened from the little red arcade button on the
// public landing page.
//
// Pure DOM + requestAnimationFrame (no canvas) to match the rest of the app.
// The physics live in a ref; a frame counter forces the re-render each tick.

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { BuddyArt } from "./BuddyArt";
import { TotArt } from "./TotArt";

const GROUND_H = 72;     // road band height (px)
const BUDDY_X = 56;      // buddy left offset (px)
const BUDDY_W = 52;
const BUDDY_H = 60;
const GRAVITY = 2600;    // px/s²
const JUMP_V = 880;      // initial up velocity (px/s)
const BASE_SPEED = 300;  // px/s
const HIGH_KEY = "soar.rollerHigh";
const NAME_KEY = "soar.rollerName";
const CHAR_KEY = "soar.rollerChar";
const LB_URL = "/.netlify/functions/roller-leaderboard";

const WIPEOUTS = ["Wiped out!", "Eat my dust… next time!", "Skate ya later!", "Tot-ally crashed."];

type CharId = "buddy" | "tot";
const CHARACTERS: { id: CharId; name: string; Art: typeof BuddyArt }[] = [
  { id: "buddy", name: "RollerBuddy", Art: BuddyArt },
  { id: "tot", name: "Tot", Art: TotArt },
];
const artFor = (id: CharId) => (id === "tot" ? TotArt : BuddyArt);

interface Score { name: string; score: number; character: string }
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
  const [character, setCharacter] = useState<CharId>(() => (localStorage.getItem(CHAR_KEY) === "tot" ? "tot" : "buddy"));
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) || "");
  const [top, setTop] = useState<Score[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const world = useRef<World>({
    y: 0, vy: 0, grounded: true, obstacles: [], speed: BASE_SPEED, score: 0,
    state: "ready", spawnIn: 1, last: 0, w: 0, h: 0, nextId: 1, wipe: WIPEOUTS[0],
  });

  useEffect(() => { localStorage.setItem(CHAR_KEY, character); }, [character]);
  useEffect(() => { localStorage.setItem(NAME_KEY, name); }, [name]);

  // Pull the leaderboard once on open.
  const loadTop = () => { fetch(LB_URL).then((r) => r.json()).then((d) => { if (d?.top) setTop(d.top); }).catch(() => {}); };
  useEffect(loadTop, []);

  // Post a finished run, then refresh the board. Reassigned each render so it
  // reads the latest name/character; the game loop calls it via the ref.
  const onGameOver = useRef<(score: number) => void>(() => {});
  onGameOver.current = (score: number) => {
    if (score <= 0) return;
    setSubmitting(true);
    fetch(LB_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() || "Anonymous", score, character }),
    }).then((r) => r.json()).then((d) => { if (d?.top) setTop(d.top); }).catch(() => {}).finally(() => setSubmitting(false));
  };

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
        w.vy -= GRAVITY * dt;
        w.y += w.vy * dt;
        if (w.y <= 0) { w.y = 0; w.vy = 0; w.grounded = true; }
        w.speed = Math.min(760, BASE_SPEED + w.score * 7);
        for (const o of w.obstacles) {
          o.x -= w.speed * dt;
          if (!o.passed && o.x + o.w < BUDDY_X) { o.passed = true; w.score += 1; }
        }
        w.obstacles = w.obstacles.filter((o) => o.x > -o.w - 12);
        w.spawnIn -= dt;
        if (w.spawnIn <= 0) {
          const hh = 34 + Math.round(Math.random() * 42);
          const ww = 22 + Math.round(Math.random() * 14);
          w.obstacles.push({ id: w.nextId++, x: w.w + 10, w: ww, h: hh, passed: false });
          const minGapPx = 240 + Math.random() * 220;
          w.spawnIn = Math.max(minGapPx / w.speed, 0.7 + Math.random() * 0.7);
        }
        for (const o of w.obstacles) {
          const overlapX = BUDDY_X + BUDDY_W - 8 > o.x && BUDDY_X + 8 < o.x + o.w;
          if (overlapX && w.y < o.h - 8) {
            w.state = "over";
            w.wipe = WIPEOUTS[Math.floor(Math.random() * WIPEOUTS.length)];
            if (w.score > high) { setHigh(w.score); localStorage.setItem(HIGH_KEY, String(w.score)); }
            onGameOver.current(w.score);
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
  const Skater = artFor(character);
  const stop = (e: React.PointerEvent) => e.stopPropagation();

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

        {/* skater */}
        <div
          className="absolute"
          style={{ left: BUDDY_X, bottom: GROUND_H + w.y, width: BUDDY_W, height: BUDDY_H, transform: w.grounded ? "none" : "rotate(-8deg)" }}
        >
          <Skater className="h-full w-full" />
        </div>

        {/* overlays */}
        {w.state !== "playing" && (
          <div className="absolute inset-0 z-10 grid place-items-center px-6 text-center">
            <div
              className="w-[min(92vw,380px)] rounded-2xl bg-white/95 px-6 py-5 shadow-xl ring-1 ring-black/5"
              onPointerDown={stop}
            >
              {w.state === "ready" ? (
                <>
                  <div className="text-lg font-bold text-midnight">Skate the strip!</div>
                  <div className="mt-1 text-sm text-midnight/70">Tap, click, or press Space to hop the cones.</div>

                  {/* character picker */}
                  <div className="mt-4">
                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-midnight/50">Choose your skater</div>
                    <div className="flex justify-center gap-3">
                      {CHARACTERS.map(({ id, name: cn, Art }) => (
                        <button
                          key={id}
                          type="button"
                          onPointerDown={stop}
                          onClick={() => setCharacter(id)}
                          className={`flex w-24 flex-col items-center rounded-xl border-2 px-2 py-2 transition ${character === id ? "border-accent bg-accent/5" : "border-zinc-200 hover:border-accent/40"}`}
                        >
                          <Art className="h-14 w-14" />
                          <span className="mt-1 text-xs font-semibold text-midnight">{cn}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* name */}
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onPointerDown={stop}
                    maxLength={20}
                    placeholder="Your name (for the leaderboard)"
                    className="mt-4 w-full rounded-lg border border-zinc-200 px-3 py-2 text-center text-sm text-midnight focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                  />

                  <button
                    type="button"
                    onPointerDown={(e) => { e.stopPropagation(); jump(); }}
                    className="mt-4 inline-flex items-center rounded-full bg-accent px-5 py-2 text-sm font-semibold text-white hover:brightness-105"
                  >
                    Tap to start
                  </button>

                  <Leaderboard top={top} />
                </>
              ) : (
                <>
                  <div className="text-xl font-bold text-[oklch(0.55_0.22_25)]">{w.wipe}</div>
                  <div className="mt-1 text-sm text-midnight/80">
                    Score <strong className="tabular-nums">{w.score}</strong> · Best <strong className="tabular-nums">{Math.max(high, w.score)}</strong>
                    {submitting && <span className="ml-2 text-midnight/50">saving…</span>}
                  </div>
                  <button
                    type="button"
                    onPointerDown={(e) => { e.stopPropagation(); jump(); }}
                    className="mt-4 inline-flex items-center rounded-full bg-accent px-5 py-2 text-sm font-semibold text-white hover:brightness-105"
                  >
                    Tap to play again
                  </button>
                  <Leaderboard top={top} />
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Leaderboard({ top }: { top: Score[] }) {
  if (!top.length) return null;
  return (
    <div className="mt-5 border-t border-zinc-100 pt-3 text-left">
      <div className="mb-1.5 text-center text-xs font-semibold uppercase tracking-wide text-midnight/50">Top skaters</div>
      <ol className="space-y-0.5">
        {top.slice(0, 5).map((s, i) => {
          const Art = artFor(s.character === "tot" ? "tot" : "buddy");
          return (
            <li key={`${s.name}-${i}`} className="flex items-center gap-2 text-sm">
              <span className="w-4 text-right font-bold tabular-nums text-midnight/50">{i + 1}</span>
              <Art className="h-5 w-5 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-midnight">{s.name}</span>
              <span className="font-bold tabular-nums text-midnight">{s.score}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
