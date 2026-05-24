// Launch / splash screen — the app's opening face. Used three ways:
//   • RootRoute boot state (auth resolving) — generic, no CTA.
//   • Logged-out landing at "/" — adds a Sign in CTA + a one-line
//     descriptor so the root URL still reads as a real business app
//     (firewall-friendliness, same concern the old LandingPage had).
//   • Authenticated cold-start overlay (AppShell) — personalized
//     greeting, fades into the home.
//
// Visual from the Claude Design "Launch / splash" canvas: illustrated
// cup hero, SOAR Field App wordmark, Sonic Operations subtitle, a
// loading line, and a "Powered by a mint" footer.

import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { SplashCup } from "./SplashCup";

interface Props {
  /** Personalized line above the wordmark, e.g. "Good morning, Marcus". */
  greeting?: string;
  /** Status line under the wordmark. Defaults to a generic loading note. */
  subline?: string;
  /** Logged-out landing variant: show a Sign in CTA + descriptor. */
  showSignIn?: boolean;
  /** Hide the animated loading dots (e.g. on the landing variant). */
  hideLoader?: boolean;
}

export function LaunchSplash({ greeting, subline, showSignIn, hideLoader }: Props) {
  return (
    <div className="relative flex min-h-full flex-col items-center justify-center overflow-hidden bg-white px-6 text-center">
      {/* Soft frost glow behind the cup */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(116,210,231,0.20),transparent_70%)]"
      />

      <div className="relative flex flex-col items-center">
        <SplashCup className="h-40 w-auto animate-[pulse_2.4s_ease-in-out_infinite] drop-shadow-[0_18px_30px_rgba(40,87,128,0.18)]" />

        {greeting && (
          <p className="mt-8 text-sm font-medium text-midnight-500">{greeting}</p>
        )}

        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-midnight">
          SOAR Field App
        </h1>
        <p className="mt-1 text-xs font-semibold uppercase tracking-[0.22em] text-midnight-400">
          Sonic Operations
        </p>

        {showSignIn ? (
          <>
            <p className="mt-5 max-w-xs text-sm text-ink-muted">
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
          !hideLoader && (
            <div className="mt-7 flex items-center gap-2 text-sm text-midnight-400">
              <span className="flex gap-1" aria-hidden="true">
                <Dot delay="0ms" />
                <Dot delay="160ms" />
                <Dot delay="320ms" />
              </span>
              <span>{subline || "Loading…"}</span>
            </div>
          )
        )}

        {showSignIn && subline && (
          <p className="mt-4 text-xs text-ink-subtle">{subline}</p>
        )}
      </div>

      <div className="absolute inset-x-0 bottom-7 text-center text-[11px] font-medium text-ink-subtle">
        Powered by <span className="text-midnight-400">a mint</span>
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-[pulse_1s_ease-in-out_infinite] rounded-full bg-frost-300"
      style={{ animationDelay: delay }}
    />
  );
}
