// src/auth/LandingPage.tsx
//
// Public-facing landing rendered at "/" for unauthenticated
// visitors. Replaces the previous behavior where the root URL
// silently bounced to /login — that pattern can flag the domain
// as a generic credential-collection page in some corporate
// firewalls and reputation services. A real landing page with
// company branding + descriptive content signals "this is a
// legitimate business app" to those classifiers.
//
// Authenticated visitors never see this page — RootRoute swaps in
// the AppShell + the protected outlet instead.
//
// Keep this page lean: no auth state, no API calls, no fetch
// dependencies. The point is "renders fast, looks legitimate".

import { Link } from "react-router-dom";
import { ArrowRight, ClipboardList, ShieldCheck, Users } from "lucide-react";
import { RollerBuddy } from "./RollerBuddy";

export function LandingPage() {
  return (
    <div className="relative min-h-full overflow-hidden bg-accent text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(116,210,231,0.4),transparent_60%)]"
      />

      <div className="relative mx-auto flex min-h-full max-w-5xl flex-col px-6 py-12 sm:px-8 lg:py-20">
        {/* Top brand strip — matches the Login page header so the
            landing and the sign-in flow feel like the same app. */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <CupPlaceholder />
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.25em] text-white/80 sm:text-sm">
                SOAR QSR
              </div>
              <div className="text-xl font-semibold tracking-tight sm:text-2xl">
                Operations Hub
              </div>
            </div>
          </div>
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-midnight transition hover:bg-zinc-100"
          >
            Sign in
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
          </Link>
        </header>

        {/* Hero */}
        <section className="mt-12 max-w-2xl lg:mt-20">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/80">
            Internal · SOAR QSR Operations
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
            Solutions That Accelerate Growth.
          </h1>
          <p className="mt-4 text-base text-white/85 sm:text-lg">
            The operations hub for SOAR QSR teams — facilities work orders,
            personnel adjustments, store management, and team contacts in one
            place. Built for the field, used from a phone.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/login"
              className="inline-flex items-center gap-2 rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-midnight transition hover:bg-zinc-100"
            >
              Sign in
              <ArrowRight className="h-4 w-4" strokeWidth={2} />
            </Link>
            <span className="text-xs text-white/70">
              Access by invite. Talk to your administrator if you need an account.
            </span>
          </div>
        </section>

        {/* Three pillars — gives the page weight + tells a firewall
            scanner this is a real app, not a credential-harvesting
            shell. */}
        <section className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-3 lg:mt-24">
          <FeatureCard
            icon={<ClipboardList className="h-5 w-5" strokeWidth={1.75} />}
            title="Work Orders"
            description="Submit and track facility service requests across every store, with vendor dispatch and quote approvals."
          />
          <FeatureCard
            icon={<Users className="h-5 w-5" strokeWidth={1.75} />}
            title="Team & Stores"
            description="See your team, your stores, and the people who own them. Built for GMs, DOs, and above-store leadership."
          />
          <FeatureCard
            icon={<ShieldCheck className="h-5 w-5" strokeWidth={1.75} />}
            title="Payroll Adjustments"
            description="Submit payroll adjustment forms with the right approval routing baked in — DO, SDO, RVP, and payroll all in the same flow."
          />
        </section>

        {/* Footer — short, legitimate. Helps with reputation
            classifiers that look for "ownership" signals.
            Extra bottom padding leaves clearance for RollerBuddy so he
            doesn't visually crowd the footer text on tall screens. */}
        <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-white/20 pt-6 pb-32 text-[11px] text-white/60 lg:mt-24">
          <div>© {new Date().getFullYear()} SOAR QSR. Internal use only.</div>
          <div className="flex items-center gap-4">
            <a
              href="https://soarqsr.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white"
            >
              soarqsr.com
            </a>
            <Link to="/login" className="hover:text-white">
              Sign in
            </Link>
          </div>
        </footer>
      </div>

      <RollerBuddy />
    </div>
  );
}

function FeatureCard({
  icon, title, description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl bg-white/10 p-4 backdrop-blur-sm ring-1 ring-white/15">
      <div className="flex items-center gap-2 text-white">
        {icon}
        <span className="text-sm font-semibold tracking-tight">{title}</span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-white/85">{description}</p>
    </div>
  );
}

// Same placeholder cup the login page uses, so the visual feels
// consistent before the user hits Sign in.
function CupPlaceholder() {
  return (
    <svg
      viewBox="0 0 64 80"
      width="56"
      height="70"
      role="img"
      aria-label="SOAR QSR mark"
      className="drop-shadow-md"
    >
      <rect x="8" y="12" width="48" height="8" rx="2" fill="white" opacity="0.95" />
      <rect x="36" y="2" width="6" height="14" rx="1.5" fill="white" opacity="0.8" />
      <path
        d="M12 22 L52 22 L46 74 Q46 78 42 78 L22 78 Q18 78 18 74 Z"
        fill="white"
        opacity="0.95"
      />
      <path
        d="M14 38 L50 38 L48.6 50 L15.4 50 Z"
        fill="#E40046"
        opacity="0.85"
      />
    </svg>
  );
}
