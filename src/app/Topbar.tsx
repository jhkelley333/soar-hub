// Topbar — desktop-only sticky header for the redesigned shell. Holds the
// global search (stores, work orders, contacts, resources), the light/dark
// theme toggle, and the notifications bell (live chat-unread count). Hidden
// under lg (mobile keeps its own status strip + MobileTabBar).
//
// The region/scope filter from the design is intentionally not here yet — it
// needs a scoped region param threaded through every dashboard query. It
// returns once that plumbing lands; shipping a no-op control is worse than
// none.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, Sun, Moon, Bell, Building2, Hammer, BookUser, BookOpen } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/auth/AuthProvider";
import { useChatUnreadCount } from "@/modules/chat/useChatUnread";
import { fetchCallerStores, fetchTickets } from "@/modules/work-orders-v2/api";
import { isOpenStatus } from "@/modules/work-orders-v2/types";
import type { CallerStore, Ticket } from "@/modules/work-orders-v2/types";
import { listContacts } from "@/modules/contacts/api";
import type { Contact } from "@/types/database";
import { cn } from "@/lib/cn";

const WO_ROLES = new Set([
  "shift_manager", "first_assistant_manager", "associate_manager", "crew_leader",
  "crew_member", "carhop", "gm", "do", "sdo", "rvp", "vp", "coo", "admin",
]);

interface Hit {
  key: string;
  icon: typeof Building2;
  label: string;
  sub: string;
  to: string;
}

export function Topbar() {
  const { theme, toggle } = useTheme();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const unread = useChatUnreadCount();

  const canWo = !!profile?.role && WO_ROLES.has(profile.role);

  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Search data is fetched lazily — only once the user opens the box — and
  // reuses the cached query keys the rest of the app already populates.
  const storesQ = useQuery({
    queryKey: ["wo2", "caller-stores"],
    queryFn: fetchCallerStores,
    enabled: open,
    staleTime: 60_000,
  });
  const ticketsQ = useQuery({
    queryKey: ["wo2", "tickets"],
    queryFn: fetchTickets,
    enabled: open && canWo,
    staleTime: 30_000,
  });
  const contactsQ = useQuery({
    queryKey: ["contacts-list"],
    queryFn: listContacts,
    enabled: open,
    staleTime: 60_000,
  });

  const hits = useMemo<Hit[]>(() => {
    const term = q.trim().toLowerCase();
    if (term.length < 1) return [];
    const out: Hit[] = [];

    const stores = (storesQ.data?.stores ?? []) as CallerStore[];
    for (const s of stores) {
      if (`${s.number} ${s.name}`.toLowerCase().includes(term)) {
        out.push({
          key: `store-${s.id}`,
          icon: Building2,
          label: `Store ${s.number}`,
          sub: s.name,
          to: "/my-stores",
        });
      }
      if (out.filter((h) => h.key.startsWith("store-")).length >= 5) break;
    }

    const tickets = (ticketsQ.data?.tickets ?? []) as Ticket[];
    const woHits = tickets
      .filter((t) => {
        const hay = [t.wo_number, t.store_number, t.store_name, t.asset_type, t.category, t.issue_description]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(term);
      })
      // Open ones first, then most recent.
      .sort((a, b) => {
        if (isOpenStatus(a.status) !== isOpenStatus(b.status)) return isOpenStatus(a.status) ? -1 : 1;
        return new Date(b.date_submitted).getTime() - new Date(a.date_submitted).getTime();
      })
      .slice(0, 5);
    for (const t of woHits) {
      out.push({
        key: `wo-${t.id}`,
        icon: Hammer,
        label: `${t.wo_number} · ${t.asset_type || t.category || "Work order"}`,
        sub: `Store ${t.store_number}${t.store_name ? ` · ${t.store_name}` : ""}`,
        to: `/admin/work-orders-v2?ticket=${encodeURIComponent(t.id)}`,
      });
    }

    const contacts = (contactsQ.data?.contacts ?? []) as Contact[];
    const contactHits = contacts
      .filter((c) => {
        const hay = [c.display_name, c.category, c.phone, c.email]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(term);
      })
      .slice(0, 5);
    for (const c of contactHits) {
      out.push({
        key: `contact-${c.id}`,
        icon: BookUser,
        label: c.display_name,
        sub: c.category || c.phone || c.email || "Contact",
        to: `/contacts?q=${encodeURIComponent(c.display_name)}`,
      });
    }

    // Resources are folder/Drive-backed (no single cached list), so deep-link
    // into the library's own search instead of duplicating it inline.
    if (term.length >= 2) {
      out.push({
        key: "resources-search",
        icon: BookOpen,
        label: `Search Resources for “${q.trim()}”`,
        sub: "Open the resource library",
        to: `/resources?q=${encodeURIComponent(q.trim())}`,
      });
    }

    return out;
  }, [q, storesQ.data, ticketsQ.data, contactsQ.data]);

  // Close on click-outside.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function go(to: string) {
    setOpen(false);
    setQ("");
    navigate(to);
  }

  const showDropdown = open && q.trim().length >= 1;

  return (
    <header
      className={cn(
        "sticky top-0 z-30 hidden items-center gap-3 border-b px-6 py-3 lg:flex",
        "border-zinc-200 bg-white/90 backdrop-blur",
        "dark:border-night-line dark:bg-night/85",
      )}
    >
      {/* Global search */}
      <div ref={boxRef} className="relative max-w-xl flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400 dark:text-night-muted"
          strokeWidth={1.75}
        />
        <input
          type="text"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter" && hits[0]) go(hits[0].to);
          }}
          placeholder="Search stores, work orders…"
          aria-label="Search"
          className={cn(
            "h-9 w-full rounded-xl border pl-9 pr-3 text-sm outline-none transition",
            "border-zinc-200 bg-zinc-50 text-ink placeholder:text-zinc-400",
            "focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/20",
            "dark:border-night-line dark:bg-night-raised dark:text-night-ink dark:placeholder:text-night-muted dark:focus:bg-night-raised",
          )}
        />

        {showDropdown && (
          <div
            className={cn(
              "absolute left-0 right-0 top-11 z-40 overflow-hidden rounded-xl border shadow-float",
              "border-zinc-200 bg-white dark:border-night-line dark:bg-night-raised",
            )}
          >
            {storesQ.isLoading || (canWo && ticketsQ.isLoading) ? (
              <div className="px-4 py-3 text-sm text-ink-muted dark:text-night-muted">Searching…</div>
            ) : hits.length === 0 ? (
              <div className="px-4 py-3 text-sm text-ink-muted dark:text-night-muted">
                No matches for “{q.trim()}”.
              </div>
            ) : (
              <ul className="max-h-80 overflow-y-auto py-1">
                {hits.map((h) => (
                  <li key={h.key}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => go(h.to)}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left transition hover:bg-zinc-50 dark:hover:bg-white/5"
                    >
                      <h.icon className="h-4 w-4 shrink-0 text-ink-subtle dark:text-night-muted" strokeWidth={1.75} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink dark:text-night-ink">{h.label}</span>
                        <span className="block truncate text-xs text-ink-muted dark:text-night-muted">{h.sub}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Theme toggle */}
      <button
        type="button"
        onClick={toggle}
        aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        title={theme === "dark" ? "Light mode" : "Dark mode"}
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-xl border transition",
          "border-zinc-200 bg-white text-ink-muted hover:border-accent hover:text-ink",
          "dark:border-night-line dark:bg-night-raised dark:text-night-muted dark:hover:text-night-ink",
        )}
      >
        {theme === "dark" ? (
          <Sun className="h-4 w-4" strokeWidth={1.75} />
        ) : (
          <Moon className="h-4 w-4" strokeWidth={1.75} />
        )}
      </button>

      {/* Notifications — chat unread. Routes to chat. */}
      <button
        type="button"
        onClick={() => navigate("/chat")}
        aria-label={unread > 0 ? `${unread} unread messages` : "Notifications"}
        title={unread > 0 ? `${unread} unread message${unread === 1 ? "" : "s"}` : "No new messages"}
        className={cn(
          "relative inline-flex h-9 w-9 items-center justify-center rounded-xl border transition",
          "border-zinc-200 bg-white text-ink-muted hover:border-accent hover:text-ink",
          "dark:border-night-line dark:bg-night-raised dark:text-night-muted dark:hover:text-night-ink",
        )}
      >
        <Bell className="h-4 w-4" strokeWidth={1.75} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-cherry px-1 text-[10px] font-semibold tabular-nums text-white ring-2 ring-white dark:ring-night">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    </header>
  );
}
