// Mobile-first home for SOAR Hub. Replaces the desktop dashboard's
// "wall of stats" layout when the viewport is narrower than lg.
//
// Intent: when a GM opens the app on their phone (icon → splash →
// fullscreen), the first screen should be calm and action-oriented,
// not a grid of giant numbers. A short greeting, a small "you're
// signed in as" line, and four big tap targets for the things the
// mobile design actually delivers right now: Approvals, Stores,
// Walkthrough, Directory.
//
// Lives in the dashboard module because it's the mobile counterpart
// of DashboardPage — same route ("/") just renders this on phones
// instead of the existing layout.

import { Link } from "react-router-dom";
import {
  Inbox,
  Building2,
  ClipboardCheck,
  BookUser,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { ROLE_LABELS } from "@/types/database";

function timeOfDayGreeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

interface Destination {
  to: string;
  label: string;
  subtitle: string;
  Icon: LucideIcon;
}

const DESTINATIONS: Destination[] = [
  {
    to: "/approvals",
    label: "Approvals",
    subtitle: "Submissions waiting on you",
    Icon: Inbox,
  },
  {
    to: "/region",
    label: "Stores",
    subtitle: "Region rollup + tier breakdown",
    Icon: Building2,
  },
  {
    to: "/walkthrough",
    label: "Walkthrough",
    subtitle: "Preview the new audit flow",
    Icon: ClipboardCheck,
  },
  {
    to: "/directory",
    label: "Directory",
    subtitle: "Your team, district, and above",
    Icon: BookUser,
  },
];

export function MobileHome() {
  const { profile } = useAuth();
  const greetingName =
    profile?.preferred_name?.trim() ||
    profile?.full_name?.split(" ")[0] ||
    "there";

  return (
    <div className="mx-auto w-full max-w-md min-h-full bg-surface-muted">
      <header className="px-4 pt-3 pb-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-midnight-500">
          {timeOfDayGreeting()}
        </p>
        <h1 className="mt-1 text-[24px] font-semibold leading-tight text-midnight-900">
          {greetingName}
        </h1>
        {profile?.role && (
          <p className="mt-1 text-[11.5px] text-midnight-500">
            Signed in as {ROLE_LABELS[profile.role]}
          </p>
        )}
      </header>

      <nav className="px-3 pb-6 space-y-2">
        {DESTINATIONS.map((d) => (
          <Link
            key={d.to}
            to={d.to}
            className="flex items-center gap-3 bg-surface rounded-xl ring-1 ring-midnight-100 shadow-card px-4 py-3.5 hover:ring-midnight-200 transition"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-frost-100 text-midnight-700">
              <d.Icon className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-semibold text-midnight-900 leading-tight">
                {d.label}
              </div>
              <div className="text-[12px] text-midnight-500 truncate">
                {d.subtitle}
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-midnight-300 shrink-0" strokeWidth={2} />
          </Link>
        ))}
      </nav>

      <div className="px-5 pb-6">
        <p className="text-[10.5px] leading-snug text-midnight-400">
          Tap More at the bottom for the full menu — work orders, PAF,
          reno scoping, and admin tools all still live there.
        </p>
      </div>
    </div>
  );
}
