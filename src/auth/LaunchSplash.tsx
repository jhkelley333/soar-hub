// Launch / splash screen — the app's opening face. Used three ways:
//   • RootRoute boot state (auth resolving) — generic, no CTA.
//   • Logged-out landing at "/" — adds a Sign in CTA + a one-line
//     descriptor so the root URL still reads as a real business app
//     (firewall-friendliness, same concern the old LandingPage had).
//   • Authenticated cold-start overlay (AppShell) — personalized
//     greeting, fades into the home.
//
// Visual from the Claude Design "Launch / splash" canvas: deep navy
// backdrop, illustrated cup hero, SOAR FIELD APP wordmark, SONIC
// OPERATIONS subtitle, a loading line + dots, and a "Powered by a mint"
// footer.

import { useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { SplashCup } from "./SplashCup";
import { enableMotion, useShake } from "./useShake";

interface Props {
  /** Personalized line above the wordmark, e.g. "Good morning, Marcus". */
  greeting?: string;
  /** Status line under the subtitle. Defaults to a generic loading note. */
  subline?: string;
  /** Logged-out landing variant: show a Sign in CTA + descriptor. */
  showSignIn?: boolean;
}

export function LaunchSplash({ greeting, subline, showSignIn }: Props) {
  // Shake (or tap) the cup → ice rattles. iOS gates motion behind a
  // permission prompt, so the first cup tap both rattles the ice and
  // requests motion access, unlocking shake for the rest of the visit.
  const [agitate, setAgitate] = useState(0);
  const motionAsked = useRef(false);
  const rattle = useCallback(() => setAgitate((a) => a + 1), []);
  useShake(rattle);
  const onCupTap = useCallback(() => {
    if (!motionAsked.current) {
      motionAsked.current = true;
      void enableMotion();
    }
    rattle();
  }, [rattle]);

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden px-6 text-center"
      style={{
        background:
          "radial-gradient(ellipse 110% 70% at 50% 38%, #2b4f73 0%, #173049 45%, #0c1c2e 100%)",
      }}
    >
      <div className="relative flex flex-col items-center">
        {greeting && (
          <p className="mb-5 text-sm font-medium text-frost-200">{greeting}</p>
        )}

        {/* Wordmark + underline accent */}
        <h1 className="text-2xl font-semibold uppercase tracking-[0.18em] text-white">
          SOAR Field App
        </h1>
        <span aria-hidden="true" className="mt-2.5 h-0.5 w-14 rounded-full bg-white/30" />

        <button
          type="button"
          onClick={onCupTap}
          aria-label="Shake or tap to rattle the ice"
          className="mt-9 appearance-none border-0 bg-transparent p-0"
        >
          <SplashCup
            agitate={agitate}
            className="h-52 w-auto drop-shadow-[0_22px_45px_rgba(0,0,0,0.40)]"
          />
        </button>

        <p className="mt-8 text-xs font-semibold uppercase tracking-[0.25em] text-frost-300">
          Sonic Operations
        </p>

        {showSignIn ? (
          <>
            <p className="mt-4 max-w-xs text-sm text-midnight-200">
              Facilities work orders, approvals, and store operations — for
              SOAR QSR field teams.
            </p>
            <Link
              to="/login"
              className="mt-7 inline-flex items-center gap-2 rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-accent-fg shadow-card transition hover:bg-accent-hover"
            >
              Sign in
              <ArrowRight className="h-4 w-4" strokeWidth={2} />
            </Link>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-midnight-200">{subline || "Loading…"}</p>
            <span className="mt-4 flex gap-1.5" aria-hidden="true">
              <Dot delay="0ms" />
              <Dot delay="160ms" />
              <Dot delay="320ms" />
            </span>
          </>
        )}
      </div>

      <div className="absolute inset-x-0 bottom-7 text-center text-[11px] font-medium text-white/40">
        Powered by <span className="text-frost-300">a mint</span>
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-[pulse_1s_ease-in-out_infinite] rounded-full bg-frost-300/80"
      style={{ animationDelay: delay }}
    />
  );
}
