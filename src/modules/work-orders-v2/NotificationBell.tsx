// Comms notification bell. Shows a badge with the total unread
// work-order messages for the caller and a dropdown listing each ticket
// with unread activity. Clicking an item deep-links to the ticket on the
// right thread, marks it seen, and refreshes the feed.
//
// Mounted twice: in the desktop Sidebar header (tone "light", left-
// aligned dropdown) and in the mobile top bar (tone "dark", right-
// aligned). The query is shared via one key so both read a single fetch.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Bell, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useWoNotifications } from "./useWoNotifications";
import { markTicketSeen } from "./api";
import type { ThreadType, WoNotification } from "./types";

function threadLabel(t: ThreadType): string {
  switch (t) {
    case "vendor":    return "Vendor";
    case "requester": return "Requester";
    case "store":     return "Store";
    default:          return "Internal";
  }
}

function relTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const min = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.floor(min / 60)}h`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function NotificationBell({
  tone = "light",
  align = "left",
}: {
  tone?: "light" | "dark";
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useWoNotifications();
  const total = q.data?.total ?? 0;
  const items = q.data?.notifications ?? [];

  function openTicket(n: WoNotification) {
    setOpen(false);
    // Optimistically clear this ticket from the feed, then persist the
    // seen-marker and refetch so the badge settles to truth.
    markTicketSeen(n.ticket_id)
      .then(() => qc.invalidateQueries({ queryKey: ["wo2", "notifications"] }))
      .catch(() => {});
    navigate(
      `/admin/work-orders-v2?ticket=${encodeURIComponent(n.ticket_id)}&thread=${n.thread_type}`,
    );
  }

  const iconColor =
    tone === "dark"
      ? "text-white/80 hover:text-white"
      : "text-zinc-500 hover:text-midnight";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn("relative rounded-md p-1.5 transition", iconColor)}
        aria-label={total > 0 ? `${total} unread messages` : "Notifications"}
      >
        <Bell className="h-5 w-5" strokeWidth={1.75} />
        {total > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-cherry px-1 text-[9px] font-semibold leading-none text-white">
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <div
            className={cn(
              "absolute z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl",
              align === "right" ? "right-0" : "left-0",
            )}
          >
            <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Messages
              </span>
              {q.isFetching && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />
              )}
            </div>

            <div className="max-h-96 overflow-y-auto">
              {items.length === 0 ? (
                <div className="px-3 py-8 text-center text-xs text-zinc-500">
                  {q.isLoading ? "Loading…" : "You're all caught up."}
                </div>
              ) : (
                items.map((n) => (
                  <button
                    key={n.ticket_id}
                    type="button"
                    onClick={() => openTicket(n)}
                    className="flex w-full items-start gap-2 border-b border-zinc-50 px-3 py-2.5 text-left hover:bg-zinc-50"
                  >
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-cherry" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-midnight">
                          {n.wo_number || "Work order"}
                        </span>
                        <span className="shrink-0 rounded bg-zinc-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-zinc-500">
                          {threadLabel(n.thread_type)}
                        </span>
                        {n.unread_count > 1 && (
                          <span className="shrink-0 text-[10px] font-semibold text-cherry">
                            {n.unread_count}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-zinc-600">
                        <span className="font-medium text-zinc-700">{n.from_name}</span>
                        {": "}
                        {n.preview}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-zinc-400">
                        {[n.store_name || n.store_number, relTime(n.at)]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
