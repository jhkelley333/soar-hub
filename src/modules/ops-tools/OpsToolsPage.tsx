// Operations Tools — a card hub for the field/store-ops tools, so they live
// behind one sidebar entry instead of sprawling. Each card links to a tool;
// "Site Audits" (the structured audit module) is coming next. Schedule stays
// its own nav item by design.

import { Link } from "react-router-dom";
import { ArrowRight, ClipboardCheck, ListChecks, QrCode, type LucideIcon } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { PageHeader } from "@/shared/ui/PageHeader";
import { cn } from "@/lib/cn";
import type { UserRole } from "@/types/database";

const DO_PLUS = new Set<UserRole>(["do", "sdo", "rvp", "vp", "coo", "admin"]);

interface Tool {
  key: string;
  title: string;
  desc: string;
  icon: LucideIcon;
  roles: UserRole[];
  // Role-aware destination, or omitted when the tool isn't built yet.
  to?: (role: UserRole) => string;
  comingSoon?: boolean;
}

const TOOLS: Tool[] = [
  {
    key: "site-audits",
    title: "Site Audits",
    desc: "Walk a store, capture issues with a photo + note, set severity & due dates, and track every gap to completion with required proof.",
    icon: ClipboardCheck,
    roles: ["gm", "do", "sdo", "rvp", "vp", "coo", "admin", "fbc"],
    to: () => "/site-audits",
  },
  {
    key: "walkthroughs",
    title: "Walkthroughs",
    desc: "Run your assigned store walkthroughs, or review submissions and manage templates across your stores.",
    icon: ListChecks,
    roles: ["shift_manager", "gm", "do", "sdo", "rvp", "vp", "coo", "admin"],
    to: (role) => (DO_PLUS.has(role) ? "/walkthroughs" : "/my-walks"),
  },
  {
    key: "qr-codes",
    title: "QR Codes",
    desc: "Generate a QR code, print or share it, then change where it points anytime — no reprinting when a site moves.",
    icon: QrCode,
    roles: ["gm", "do", "sdo", "rvp", "vp", "coo", "admin"],
    to: () => "/qr-codes",
  },
];

export function OpsToolsPage() {
  const { profile } = useAuth();
  const role = profile?.role as UserRole | undefined;
  const tools = role ? TOOLS.filter((t) => t.roles.includes(role)) : [];

  return (
    <>
      <PageHeader
        title="Operations Tools"
        description="Field and store-operations tools in one place. Pick a tool to get started."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map((t) => {
          const Icon = t.icon;
          const href = !t.comingSoon && t.to && role ? t.to(role) : null;
          const inner = (
            <>
              <div className="flex items-start justify-between">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  <Icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                {t.comingSoon ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                    Coming soon
                  </span>
                ) : (
                  <ArrowRight className="h-4 w-4 text-zinc-300 transition group-hover:translate-x-0.5 group-hover:text-accent" strokeWidth={2} />
                )}
              </div>
              <div className="mt-4 text-base font-semibold tracking-tight text-ink dark:text-night-ink">{t.title}</div>
              <p className="mt-1 text-sm leading-relaxed text-ink-muted dark:text-night-muted">{t.desc}</p>
            </>
          );

          const base =
            "group block rounded-2xl border p-5 text-left transition";
          if (href) {
            return (
              <Link
                key={t.key}
                to={href}
                className={cn(base, "border-zinc-200 bg-white shadow-card hover:border-accent/60 hover:shadow-float dark:border-night-line dark:bg-night-raised")}
              >
                {inner}
              </Link>
            );
          }
          return (
            <div
              key={t.key}
              className={cn(base, "cursor-default border-dashed border-zinc-200 bg-white/60 dark:border-night-line dark:bg-night-raised/60")}
              aria-disabled
            >
              {inner}
            </div>
          );
        })}
      </div>
    </>
  );
}
