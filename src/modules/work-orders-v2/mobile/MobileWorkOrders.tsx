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

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, MessageSquare, Clock } from "lucide-react";
import { AppHeader } from "@/shared/ui/AppHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Segmented } from "@/shared/ui/Segmented";
import { TierBar } from "@/shared/ui/Tier";
import { cn } from "@/lib/cn";
import { fetchTickets } from "../api";
import { statusLabel, isOpenStatus, type Ticket } from "../types";
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

  const ticketsQ = useQuery({
    queryKey: ["wo2-tickets"],
    queryFn: () => fetchTickets().then((r) => r.tickets),
    staleTime: 30_000,
  });

  const tickets = ticketsQ.data ?? [];
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
        <div className="px-3 pt-2 pb-12 space-y-2">
          {filtered.length === 0 ? (
            <p className="text-center text-[12px] text-midnight-500 py-10">
              {q || status !== "open"
                ? "No work orders match these filters."
                : "No open work orders. Nice."}
            </p>
          ) : (
            filtered.map((t) => (
              <TicketCard key={t.id} ticket={t} onOpen={() => openTicket(t.id)} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function TicketCard({ ticket, onOpen }: { ticket: Ticket; onOpen: () => void }) {
  const tier = ticketTier(ticket);
  const unread = ticket.unread_message_count ?? 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative block w-full text-left bg-surface rounded-xl ring-1 ring-midnight-100 shadow-card pl-4 pr-3 py-3 hover:ring-midnight-200 transition"
    >
      <TierBar tier={tier} />
      <div className="flex items-start gap-3">
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
