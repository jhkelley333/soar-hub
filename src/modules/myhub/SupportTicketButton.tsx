// Global "Support Ticket" launcher. Rendered in the desktop Topbar and as a
// floating button on mobile / full-bleed pages, so it's reachable top-right on
// every page. Opening it captures the page the user is currently on.

import { useState } from "react";
import { useLocation } from "react-router-dom";
import { LifeBuoy } from "lucide-react";
import { cn } from "@/lib/cn";
import { NewTicketModal } from "./NewTicketModal";

export function SupportTicketButton({ variant = "topbar", className }: { variant?: "topbar" | "floating"; className?: string }) {
  const [open, setOpen] = useState(false);
  const { pathname, search } = useLocation();
  const pagePath = `${pathname}${search || ""}`;

  return (
    <>
      {variant === "topbar" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open a support ticket"
          title="Report an issue or idea"
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium transition",
            "border-zinc-200 bg-white text-ink-muted hover:border-accent hover:text-ink",
            "dark:border-night-line dark:bg-night-raised dark:text-night-muted dark:hover:text-night-ink",
            className,
          )}
        >
          <LifeBuoy className="h-4 w-4" strokeWidth={1.75} />
          <span className="hidden xl:inline">Support</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
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
      )}

      <NewTicketModal open={open} onClose={() => setOpen(false)} pagePath={pagePath} />
    </>
  );
}
