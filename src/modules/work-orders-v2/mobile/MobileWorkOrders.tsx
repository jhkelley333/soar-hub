// Mobile-first Work Orders — Phase 1: view & track.
//
// Renders at /admin/work-orders-v2 on screens below lg (the desktop
// WorkOrdersV2Page renders at lg+). Role-aware via the same RLS-scoped
// fetchTickets() the desktop uses, so a GM sees their store and a DO+
// sees their whole scope without any client-side role branching.
//
// A sticky search + status filter sit under the header; tapping a card
// opens a read-only detail panel over the list. The ?ticket=<id> query
// param (used by the Approvals queue deep-link) auto-opens that ticket.
//
// Phase 2 adds status transitions + chat; Phase 3 adds create; Phase 4
// folds quote approvals into the detail. This file stays read-only.

import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, MessageSquare, Clock, Plus, RefreshCw, Check } from "lucide-react";
import { AppHeader } from "@/shared/ui/AppHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Segmented } from "@/shared/ui/Segmented";
import { TierBar } from "@/shared/ui/Tier";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { fetchTickets } from "../api";
import { statusLabel, isOpenStatus, type Ticket } from "../types";
import { NewTicketModal } from "../NewTicketModal";
import { VendorSnippetModal } from "../VendorSnippetModal";
import {
  ticketTier,
  priorityChipClass,
  ticketAge,
  matchesStatusFilter,
  type WoStatusFilter,
} from "./woMobile";
import { MobileTicketDetail } from "./MobileTicketDetail";

export function MobileWorkOrders() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("ticket");

  const [status, setStatus] = useState<WoStatusFilter>("open");
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  // Multi-select → "Send to vendor" WhatsApp snippet.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [snippetOpen, setSnippetOpen] = useState(false);
  const toggleSel = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const qc = useQueryClient();
  const toast = useToast();

  // Same key + queryFn shape as the desktop page so a transition fired
  // from the detail (which invalidates ["wo2","tickets"]) refreshes this
  // list too. Desktop and mobile never mount together (useIsDesktop),
  // so sharing the cache entry is safe.
  const ticketsQ = useQuery({
    queryKey: ["wo2", "tickets"],
    queryFn: fetchTickets,
    staleTime: 30_000,
    // Auto-refresh when returning to the app / reconnecting.
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const tickets = ticketsQ.data?.tickets ?? [];
  const q = query.trim().toLowerCase();

  const openCount = useMemo(
    () => tickets.filter((t) => isOpenStatus(t.status)).length,
    [tickets],
  );

  const filtered = useMemo(() => {
    return tickets
      .filter((t) => matchesStatusFilter(t, status))
      .filter((t) =>
        !q
          ? true
          : [
              t.wo_number,
              t.store_number,
              t.store_name,
              t.category,
              t.asset_type,
              t.issue_description,
              t.vendor_name,
              t.submitted_by,
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(q),
      )
      .sort((a, b) => {
        // Worst tier first, then newest.
        const rank = { red: 0, yellow: 1, green: 2 } as const;
        const ta = ticketTier(a);
        const tb = ticketTier(b);
        if (rank[ta] !== rank[tb]) return rank[ta] - rank[tb];
        return (
          new Date(b.date_submitted).getTime() -
          new Date(a.date_submitted).getTime()
        );
      });
  }, [tickets, status, q]);

  function openTicket(id: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("ticket", id);
        return next;
      },
      { replace: false },
    );
  }

  function closeTicket() {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("ticket");
        return next;
      },
      { replace: false },
    );
  }

  // Detail panel takes over the whole screen when a ticket is selected.
  if (selectedId) {
    return <MobileTicketDetail ticketId={selectedId} onBack={closeTicket} />;
  }

  return (
    <div className="mx-auto w-full max-w-md bg-surface-muted min-h-full">
      <AppHeader
        title="Work Orders"
        subtitle={ticketsQ.data ? `${openCount} open` : "Loading…"}
        trailing={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => { setSelecting((s) => !s); setSelected(new Set()); }}
              className="px-2 py-1 text-[12px] font-semibold text-accent"
            >
              {selecting ? "Done" : "Select"}
            </button>
            <button
              type="button"
              onClick={() => ticketsQ.refetch()}
              disabled={ticketsQ.isFetching}
              className="p-1 text-midnight-500 hover:text-midnight-900 disabled:opacity-50"
              aria-label="Refresh"
            >
              <RefreshCw
                className={cn("h-4 w-4", ticketsQ.isFetching && "animate-spin")}
                strokeWidth={2}
              />
            </button>
          </div>
        }
      />

      {/* Search */}
      <div className="px-4 pt-3 pb-3 bg-white border-b border-midnight-100 sticky top-12 z-10">
        <div className="flex items-center gap-2 bg-midnight-50 ring-1 ring-midnight-100 rounded-lg px-3 h-9">
          <Search className="h-3.5 w-3.5 text-midnight-400" strokeWidth={2} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="WO #, store, asset, vendor…"
            className="flex-1 bg-transparent text-[13px] text-midnight-900 placeholder:text-midnight-400 outline-none"
          />
        </div>
      </div>

      {/* Status filter */}
      <div className="px-3 pt-3 pb-2 bg-surface-muted overflow-x-auto">
        <Segmented<WoStatusFilter>
          value={status}
          onChange={setStatus}
          dense
          options={[
            { value: "open", label: "Open" },
            { value: "in_progress", label: "In progress" },
            { value: "on_site", label: "On site" },
            { value: "completed", label: "Completed" },
            { value: "all", label: "All" },
          ]}
        />
      </div>

      {ticketsQ.isLoading && (
        <div className="px-3 pt-2 space-y-2">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      )}

      {ticketsQ.isError && (
        <div className="p-4">
          <EmptyState
            title="Couldn't load work orders"
            description={(ticketsQ.error as Error)?.message ?? "Try again."}
          />
        </div>
      )}

      {ticketsQ.data && (
        <div className="px-3 pt-2 pb-24 space-y-2">
          {filtered.length === 0 ? (
            <p className="text-center text-[12px] text-midnight-500 py-10">
              {q || status !== "open"
                ? "No work orders match these filters."
                : "No open work orders. Nice."}
            </p>
          ) : (
            filtered.map((t) => (
              <TicketCard
                key={t.id}
                ticket={t}
                selecting={selecting}
                selected={selected.has(t.id)}
                onToggle={() => toggleSel(t.id)}
                onOpen={() => openTicket(t.id)}
              />
            ))
          )}
        </div>
      )}

      {/* New-ticket FAB — hidden while selecting (the send bar takes over). */}
      {!selecting && (
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="fixed right-4 z-30 inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-3 text-[13px] font-semibold text-white shadow-float hover:bg-accent-hover transition"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 4.75rem)" }}
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          New
        </button>
      )}

      {/* Send-to-vendor bar — appears while selecting, above the tab bar. */}
      {selecting && (
        <div
          className="fixed inset-x-0 z-30 border-t border-midnight-100 bg-white px-4 py-3 shadow-float"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 3.5rem)" }}
        >
          <button
            type="button"
            disabled={selected.size === 0}
            onClick={() => setSnippetOpen(true)}
            className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-accent px-4 py-3 text-[14px] font-semibold text-white disabled:opacity-40"
          >
            <MessageSquare className="h-4 w-4" strokeWidth={2.25} />
            Send {selected.size || ""} to vendor
          </button>
        </div>
      )}

      {snippetOpen && <VendorSnippetModal ids={[...selected]} onClose={() => setSnippetOpen(false)} />}

      <NewTicketModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(woNumber) => {
          setCreateOpen(false);
          qc.invalidateQueries({ queryKey: ["wo2", "tickets"] });
          toast.push(`Work order ${woNumber} submitted.`, "success");
        }}
        onError={(msg) => toast.push(msg, "error")}
      />
    </div>
  );
}

function TicketCard({
  ticket, onOpen, selecting, selected, onToggle,
}: {
  ticket: Ticket;
  onOpen: () => void;
  selecting?: boolean;
  selected?: boolean;
  onToggle?: () => void;
}) {
  const tier = ticketTier(ticket);
  const unread = ticket.unread_message_count ?? 0;
  return (
    <button
      type="button"
      onClick={selecting ? onToggle : onOpen}
      className={cn(
        "relative block w-full text-left bg-surface rounded-xl ring-1 shadow-card pl-4 pr-3 py-3 transition",
        selected ? "ring-2 ring-accent" : "ring-midnight-100 hover:ring-midnight-200",
      )}
    >
      <TierBar tier={tier} />
      <div className="flex items-start gap-3">
        {selecting && (
          <span
            className={cn(
              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
              selected ? "border-accent bg-accent text-white" : "border-midnight-300",
            )}
          >
            {selected && <Check className="h-3 w-3" strokeWidth={3} />}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] font-semibold text-midnight-500">
              {ticket.wo_number}
            </span>
            <span
              className={cn(
                "text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5",
                priorityChipClass(ticket.priority),
              )}
            >
              {ticket.priority}
            </span>
            {ticket.is_business_critical && (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-sonic-700">
                Critical
              </span>
            )}
          </div>
          <div className="mt-1 text-[15px] font-semibold text-midnight-900 leading-tight line-clamp-2">
            {ticket.issue_description || ticket.category || "Work order"}
          </div>
          <div className="text-[12px] text-midnight-500 truncate">
            SDI {ticket.store_number}
            {ticket.store_name ? ` · ${ticket.store_name}` : ""}
            {ticket.category ? ` · ${ticket.category}` : ""}
          </div>
          <div className="mt-1.5 flex items-center gap-3 text-[11.5px] text-midnight-500">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" strokeWidth={2} />
              {ticketAge(ticket.date_submitted)}
            </span>
            {unread > 0 && (
              <span className="inline-flex items-center gap-1 text-accent">
                <MessageSquare className="h-3 w-3" strokeWidth={2} />
                {unread}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end shrink-0">
          <span className="text-[11px] font-medium text-midnight-600">
            {statusLabel(ticket.status)}
          </span>
          {ticket.vendor_name && (
            <span className="mt-1 text-[10.5px] text-midnight-400 truncate max-w-[110px]">
              {ticket.vendor_name}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
