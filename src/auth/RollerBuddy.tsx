// RollerBuddy — Sonic-flavored mascot for the public landing page.
//
// A red-faced, blue roller-skating buddy who rolls back and forth across
// the bottom of the viewport. Eyes track the cursor (desktop) or finger
// (touch). Tap him for a hop + a random catchphrase.
//
// Rendered only on the unauthenticated landing — once a visitor signs in
// the AppShell takes over and he's gone. Keeps the personality on the
// front door without distracting people doing work.

import { useEffect, useRef, useState } from "react";
import { BuddyArt } from "./BuddyArt";

// Hoisted so the array isn't reallocated every render.
const PHRASES = [
  "This is how we roll!",
  "Tots awesome day!",
  "You are sauceome!!",
  "Skate ya later!",
];

export function RollerBuddy() {
  const [x, setX] = useState(40);
  const [dir, setDir] = useState<1 | -1>(1);
  const [hop, setHop] = useState(false);
  const [speech, setSpeech] = useState<string | null>(null);
  const [pupil, setPupil] = useState({ x: 0, y: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);

  // Roll across the screen. RAF + delta-time so speed stays consistent
  // regardless of refresh rate.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setX((prev) => {
        const maxX = window.innerWidth - 120;
        let next = prev + dir * 90 * dt;
        if (next > maxX) {
          next = maxX;
          setDir(-1);
        } else if (next < 20) {
          next = 20;
          setDir(1);
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dir]);

  // Eyes follow cursor on desktop, finger on touch. Same math both ways:
  // unit vector from buddy center to pointer, scaled to a pupil radius.
  useEffect(() => {
    function aimAt(clientX: number, clientY: number) {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = clientX - cx;
      const dy = clientY - cy;
      const len = Math.hypot(dx, dy) || 1;
      const r = 3;
      setPupil({ x: (dx / len) * r, y: (dy / len) * r });
    }
    const onMove = (e: MouseEvent) => aimAt(e.clientX, e.clientY);
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) aimAt(t.clientX, t.clientY);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onTouch, { passive: true });
    window.addEventListener("touchstart", onTouch, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onTouch);
      window.removeEventListener("touchstart", onTouch);
    };
  }, []);

  const handleClick = () => {
    setHop(true);
    setSpeech(PHRASES[Math.floor(Math.random() * PHRASES.length)]);
    window.setTimeout(() => setHop(false), 500);
    window.setTimeout(() => setSpeech(null), 1600);
  };

  return (
    <div
      ref={wrapRef}
      onClick={handleClick}
      className="pointer-events-auto fixed bottom-10 z-50 cursor-pointer select-none"
      style={{
        transform: `translateX(${x}px) scaleX(${dir})`,
        transition: "transform 16ms linear",
        // Lift him above the iOS home indicator / Android nav bar so he
        // never disappears behind a system chrome inset.
        marginBottom: "env(safe-area-inset-bottom, 0px)",
      }}
      aria-label="Friendly mascot — tap to say hi"
      role="button"
    >
      {speech && (
        <div
          className="absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-white px-3 py-1 text-xs font-semibold text-[oklch(0.55_0.22_25)] shadow-md"
          style={{ transform: `translateX(-50%) scaleX(${dir})` }}
        >
          {speech}
        </div>
      )}
      <div
        style={{
          animation: hop
            ? "rb-hop 0.5s ease-out"
            : "rb-bob 0.6s ease-in-out infinite alternate",
        }}
      >
        <BuddyArt pupil={pupil} className="h-[105px] w-[88px] sm:h-[120px] sm:w-[100px]" />
      </div>
      <style>{`
        @keyframes rb-bob {
          from { transform: translateY(0); }
          to   { transform: translateY(-3px); }
        }
        @keyframes rb-hop {
          0%   { transform: translateY(0) scale(1,1); }
          30%  { transform: translateY(-26px) scale(0.95,1.08); }
          60%  { transform: translateY(0) scale(1.08,0.92); }
          100% { transform: translateY(0) scale(1,1); }
        }
      `}</style>
    </div>
  );
}
