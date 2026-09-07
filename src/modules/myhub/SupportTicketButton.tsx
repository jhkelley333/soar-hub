// Global "Support Ticket" launcher. Rendered in the desktop Topbar and as a
// floating button on mobile / full-bleed pages, so it's reachable top-right on
// every page. Opening it captures the page the user is currently on.
//
// First-run announcement: a small dismissible callout points at this button so
// the team discovers the feature. It shows once per person (per device) and is
// remembered in localStorage — bump ANNOUNCE_KEY to re-announce a future change.
// Opening the ticket modal also dismisses it (they've clearly found it).

import { useState } from "react";
import { useLocation } from "react-router-dom";
import { LifeBuoy, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { NewTicketModal } from "./NewTicketModal";

const ANNOUNCE_KEY = "soar_announce_support_ticket_v1";

function announceDismissed(): boolean {
  try { return localStorage.getItem(ANNOUNCE_KEY) === "1"; } catch { return true; }
}

export function SupportTicketButton({ variant = "topbar", className }: { variant?: "topbar" | "floating"; className?: string }) {
  const [open, setOpen] = useState(false);
  const [showAnnounce, setShowAnnounce] = useState(() => !announceDismissed());
  const { pathname, search } = useLocation();
  const pagePath = `${pathname}${search || ""}`;

  const dismissAnnounce = () => {
    try { localStorage.setItem(ANNOUNCE_KEY, "1"); } catch { /* ignore */ }
    setShowAnnounce(false);
  };
  const openModal = () => { dismissAnnounce(); setOpen(true); };

  const announcement = showAnnounce ? (
    <div
      role="dialog"
      aria-label="New feature"
      className={cn(
        "z-50 w-72 rounded-xl border border-accent/20 bg-white p-3 text-left shadow-xl ring-1 ring-black/5",
        "dark:border-accent/30 dark:bg-night-raised",
        variant === "topbar"
          ? "absolute right-0 top-full mt-2"
          : "fixed right-3 top-[calc(env(safe-area-inset-top,0px)_+_3.25rem)]",
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-midnight dark:text-night-ink">New: Support Tickets</p>
          <p className="mt-0.5 text-xs text-zinc-600 dark:text-night-muted">
            Spot a bug or have an idea for <span className="font-medium">MySoarHub</span>? Send it to the
            team right here — from any page.
          </p>
          <button
            type="button"
            onClick={dismissAnnounce}
            className="mt-2 inline-flex items-center rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90"
          >
            Got it
          </button>
        </div>
        <button
          type="button"
          onClick={dismissAnnounce}
          aria-label="Dismiss"
          className="ml-auto shrink-0 rounded-md p-0.5 text-zinc-400 hover:text-zinc-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  ) : null;

  return (
    <>
      {variant === "topbar" ? (
        <span className="relative inline-flex">
          <button
            type="button"
            onClick={openModal}
            aria-label="Open a support ticket"
            title="Report an issue or idea"
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium transition",
              "border-zinc-200 bg-white text-ink-muted hover:border-accent hover:text-ink",
              "dark:border-night-line dark:bg-night-raised dark:text-night-muted dark:hover:text-night-ink",
              showAnnounce && "border-accent text-ink",
              className,
            )}
          >
            <LifeBuoy className="h-4 w-4" strokeWidth={1.75} />
            <span className="hidden xl:inline">Support</span>
          </button>
          {announcement}
        </span>
      ) : (
        <>
          <button
            type="button"
            onClick={openModal}
            aria-label="Open a support ticket"
            title="Report an issue or idea"
            className={cn(
              "fixed right-3 z-30 inline-flex h-11 w-11 items-center justify-center rounded-full bg-accent text-white shadow-lg ring-1 ring-black/5 transition active:scale-95",
              "top-[calc(env(safe-area-inset-top,0px)_+_0.5rem)]",
              className,
            )}
          >
            <LifeBuoy className="h-5 w-5" strokeWidth={1.75} />
          </button>
          {announcement}
        </>
      )}

      <NewTicketModal open={open} onClose={() => setOpen(false)} pagePath={pagePath} />
    </>
  );
}
