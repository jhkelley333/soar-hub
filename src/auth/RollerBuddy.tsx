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
        <svg
          viewBox="0 0 100 120"
          className="h-[105px] w-[88px] sm:h-[120px] sm:w-[100px]"
        >
          {/* shadow */}
          <ellipse cx="50" cy="115" rx="30" ry="3" fill="rgba(0,0,0,0.18)" />

          {/* arms */}
          <path
            d="M22 62 Q10 72 18 84"
            stroke="oklch(0.55 0.18 250)"
            strokeWidth="7"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M78 62 Q90 72 82 84"
            stroke="oklch(0.55 0.18 250)"
            strokeWidth="7"
            strokeLinecap="round"
            fill="none"
          />

          {/* head */}
          <circle cx="50" cy="40" r="32" fill="oklch(0.62 0.22 25)" />
          {/* eye whites (sclera tint = blue per reference) */}
          <ellipse cx="40" cy="36" rx="7" ry="6" fill="oklch(0.78 0.14 240)" />
          <ellipse cx="60" cy="36" rx="7" ry="6" fill="oklch(0.78 0.14 240)" />
          {/* pupils */}
          <circle cx={40 + pupil.x} cy={36 + pupil.y} r="2.5" fill="oklch(0.2 0.05 250)" />
          <circle cx={60 + pupil.x} cy={36 + pupil.y} r="2.5" fill="oklch(0.2 0.05 250)" />
          {/* smile */}
          <path
            d="M40 50 Q50 60 60 50 Q55 56 50 56 Q45 56 40 50 Z"
            fill="oklch(0.78 0.14 240)"
          />

          {/* skates body */}
          <rect x="28" y="80" width="18" height="14" rx="4" fill="oklch(0.55 0.18 250)" />
          <rect x="54" y="80" width="18" height="14" rx="4" fill="oklch(0.55 0.18 250)" />
          {/* skate plates */}
          <rect x="26" y="94" width="22" height="4" rx="2" fill="oklch(0.45 0.18 250)" />
          <rect x="52" y="94" width="22" height="4" rx="2" fill="oklch(0.45 0.18 250)" />
          {/* wheels */}
          <circle cx="30" cy="104" r="5" fill="oklch(0.55 0.18 250)" />
          <circle cx="44" cy="104" r="5" fill="oklch(0.55 0.18 250)" />
          <circle cx="56" cy="104" r="5" fill="oklch(0.55 0.18 250)" />
          <circle cx="70" cy="104" r="5" fill="oklch(0.55 0.18 250)" />
          <circle cx="30" cy="104" r="1.5" fill="oklch(0.3 0.1 250)" />
          <circle cx="44" cy="104" r="1.5" fill="oklch(0.3 0.1 250)" />
          <circle cx="56" cy="104" r="1.5" fill="oklch(0.3 0.1 250)" />
          <circle cx="70" cy="104" r="1.5" fill="oklch(0.3 0.1 250)" />
        </svg>
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
