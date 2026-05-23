// Mobile ticket detail — Work Order Approval surface.
//
// Layout follows the Claude Design WO Approval mock, mapped onto our
// real data: a midnight cost hero, the request + requester, evidence
// photos, the structured details, and an approval chain. When the
// viewer can decide a pending approval (DO+), a sticky Reject / Request
// info / Approve action bar pins to the bottom; otherwise the existing
// ApprovalSection handles requesting / read-only state.
//
// Pieces that need backend (line-item breakdown, a true multi-step
// chain, the needs_info email flow) are intentionally left to later
// slices — see the gap table in the PR.

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Clock, MapPin, Wrench, User2, Paperclip, RefreshCw } from "lucide-react";
import { AppHeader } from "@/shared/ui/AppHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Avatar } from "@/shared/ui/Avatar";
import { Lightbox } from "@/shared/ui/Lightbox";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import { fetchTicket, markTicketSeen } from "../api";
import type { TicketActivity } from "../types";
import { StatusBar } from "../StatusBar";
import { TicketActionBar } from "../TicketActionBar";
import { TicketChat } from "../TicketChat";
import { ApprovalSection } from "../ApprovalSection";
import { CostHero } from "./CostHero";
import { ApprovalChain } from "./ApprovalChain";
import { ApprovalActionBar } from "./ApprovalActionBar";
import { relativeTime, isApprover, formatDollars } from "./woMobile";

export function MobileTicketDetail({
  ticketId,
  onBack,
}: {
  ticketId: string;
  onBack: () => void;
}) {
  const { profile } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const q = useQuery({
    queryKey: ["wo2-ticket", ticketId],
    queryFn: () => fetchTicket(ticketId).then((r) => r.ticket),
    staleTime: 15_000,
    // Re-pull when the user returns to the app or reconnects, so an
    // approver who backgrounded the PWA sees the latest state.
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const t = q.data;

  // Mark the ticket's unread messages as seen on open, then refresh the
  // list so its unread badge clears. Best-effort — failure is silent.
  useEffect(() => {
    let cancelled = false;
    markTicketSeen(ticketId)
      .then(() => {
        if (!cancelled) qc.invalidateQueries({ queryKey: ["wo2", "tickets"] });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ticketId, qc]);

  const isSubmitter =
    !!profile?.id &&
    !!t?.submitted_by_user_id &&
    profile.id === t.submitted_by_user_id;

  const approvals = t?.ticket_approvals ?? [];
  const latest = approvals.length > 0 ? approvals[approvals.length - 1] : null;
  const pending = latest?.status === "Pending" ? latest : null;
  const canDecide = !!pending && isApprover(profile?.role);

  function refreshTicket() {
    qc.invalidateQueries({ queryKey: ["wo2-ticket", ticketId] });
    qc.invalidateQueries({ queryKey: ["wo2", "tickets"] });
  }

  const subtitle = t
    ? [t.category, t.asset_type, `SDI ${t.store_number}`].filter(Boolean).join(" · ")
    : "Loading…";

  return (
    <div className="mx-auto flex w-full max-w-md flex-col bg-surface-muted min-h-full">
      <AppHeader
        title={t ? t.wo_number : "Work order"}
        subtitle={subtitle}
        leading={
          <button
            type="button"
            onClick={onBack}
            className="-ml-1 p-1 text-midnight-600 hover:text-midnight-900"
            aria-label="Back to work orders"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={2} />
          </button>
        }
        trailing={
          <button
            type="button"
            onClick={() => q.refetch()}
            disabled={q.isFetching}
            className="p-1 text-midnight-500 hover:text-midnight-900 disabled:opacity-50"
            aria-label="Refresh"
          >
            <RefreshCw
              className={cn("h-4 w-4", q.isFetching && "animate-spin")}
              strokeWidth={2}
            />
          </button>
        }
      />

      {q.isLoading && (
        <div className="p-4 space-y-3">
          <Skeleton className="h-32 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      )}

      {q.isError && (
        <div className="p-4">
          <EmptyState
            title="Couldn't load this work order"
            description={(q.error as Error)?.message ?? "Try again."}
          />
        </div>
      )}

      {t && (
        <div className="flex-1 px-3 pt-3 pb-8 space-y-3">
          <CostHero ticket={t} latest={latest} canDecide={canDecide} />

          {/* Request */}
          <section className="bg-surface rounded-xl ring-1 ring-midnight-100 shadow-card p-4">
            <SectionTitle inline>Request</SectionTitle>
            <h1 className="mt-1 text-[17px] font-semibold text-midnight-900 leading-snug">
              {t.issue_description || t.category || "Work order"}
            </h1>
            <div className="mt-2 flex items-center gap-2">
              <Avatar name={t.submitted_by || ""} size={24} />
              <span className="text-[12.5px] text-midnight-700">
                {t.submitted_by || "Requester"}
              </span>
              <span className="inline-flex items-center gap-1 text-[11.5px] text-midnight-400">
                <Clock className="h-3 w-3" strokeWidth={2} />
                {relativeTime(t.date_submitted)}
              </span>
            </div>
            {latest?.quote_url && (
              <a
                href={latest.quote_url}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-frost-100 px-2.5 py-1.5 text-[12px] font-medium text-accent hover:bg-frost-200"
              >
                <Paperclip className="h-3.5 w-3.5" strokeWidth={2} />
                View quote
              </a>
            )}
          </section>

          {/* Evidence */}
          {t.ticket_photos && t.ticket_photos.length > 0 && (
            <section>
              <SectionTitle>Evidence · {t.ticket_photos.length} photos</SectionTitle>
              <div className="grid grid-cols-3 gap-2 px-1">
                {t.ticket_photos.map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setLightboxIndex(i)}
                    className="block aspect-square rounded-lg overflow-hidden ring-1 ring-midnight-100 bg-surface-sunk"
                  >
                    <img
                      src={p.file_url}
                      alt={p.file_name ?? "Evidence photo"}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Line items — cost breakdown feeding the hero's total. */}
          {t.line_items && t.line_items.length > 0 && (
            <section>
              <SectionTitle>Line items</SectionTitle>
              <div className="bg-surface rounded-xl ring-1 ring-midnight-100 shadow-card divide-y divide-midnight-100">
                {t.line_items.map((li, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] text-midnight-900 truncate">
                        {li.label}
                      </div>
                      {li.qty > 1 && (
                        <div className="text-[11px] text-midnight-400">Qty {li.qty}</div>
                      )}
                    </div>
                    <div className="text-[13.5px] font-semibold text-midnight-900 tabular-nums">
                      {formatDollars(li.amount_cents / 100)}
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between px-4 py-2.5 bg-surface-sunk">
                  <span className="text-[12px] font-semibold uppercase tracking-wider text-midnight-500">
                    Total
                  </span>
                  <span className="text-[15px] font-semibold text-midnight-900 tabular-nums">
                    {formatDollars(
                      t.line_items.reduce((s, li) => s + li.amount_cents, 0) / 100,
                    )}
                  </span>
                </div>
              </div>
            </section>
          )}

          {/* Details */}
          <section className="bg-surface rounded-xl ring-1 ring-midnight-100 shadow-card divide-y divide-midnight-100">
            <Fact icon={MapPin} label="Store">
              SDI {t.store_number}
              {t.store_name ? ` · ${t.store_name}` : ""}
            </Fact>
            {(t.category || t.asset_type) && (
              <Fact icon={Wrench} label="Asset">
                {[t.category, t.asset_type, t.model_number].filter(Boolean).join(" · ")}
              </Fact>
            )}
            {t.vendor_name && (
              <Fact icon={User2} label="Vendor">
                {t.vendor_name}
              </Fact>
            )}
          </section>

          {/* Approval chain */}
          {latest && (
            <section>
              <SectionTitle>Approval chain</SectionTitle>
              <ApprovalChain ticket={t} latest={latest} canDecide={canDecide} />
            </section>
          )}

          {/* Request / read-only approval state when the viewer isn't
              deciding a pending row (the sticky bar handles that case). */}
          {!canDecide && (
            <section>
              <div className="bg-surface rounded-xl ring-1 ring-midnight-100 shadow-card p-4">
                <ApprovalSection
                  ticket={t}
                  callerRole={profile?.role ?? ""}
                  onChanged={refreshTicket}
                  onError={(msg) => toast.push(msg, "error")}
                />
              </div>
            </section>
          )}

          {/* Lifecycle status + transitions. */}
          <section>
            <SectionTitle>Status</SectionTitle>
            <div className="bg-surface rounded-xl ring-1 ring-midnight-100 shadow-card p-4 space-y-3">
              <div className="overflow-x-auto">
                <StatusBar
                  status={t.status}
                  pauseState={t.pause_state}
                  closedByStore={t.closed_by_store}
                />
              </div>
              <TicketActionBar
                ticketId={t.id}
                status={t.status}
                closedAt={t.closed_at}
                storeNumber={t.store_number}
                isSubmitter={isSubmitter}
              />
            </div>
          </section>

          {/* Messages */}
          <section>
            <SectionTitle>Messages</SectionTitle>
            <div className="bg-surface rounded-xl ring-1 ring-midnight-100 shadow-card p-3">
              <TicketChat ticketId={t.id} onError={(msg) => toast.push(msg, "error")} />
            </div>
          </section>

          {/* Activity */}
          {t.ticket_activities && t.ticket_activities.length > 0 && (
            <section>
              <SectionTitle>Activity</SectionTitle>
              <div className="bg-surface rounded-xl ring-1 ring-midnight-100 shadow-card p-4 space-y-3">
                {[...t.ticket_activities]
                  .sort(
                    (a, b) =>
                      new Date(b.created_at).getTime() -
                      new Date(a.created_at).getTime(),
                  )
                  .map((a) => (
                    <ActivityRow key={a.id} activity={a} />
                  ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Sticky approval bar — only for an approver with a pending row. */}
      {t && canDecide && pending && (
        <ApprovalActionBar ticket={t} approval={pending} onChanged={refreshTicket} />
      )}

      {t?.ticket_photos && lightboxIndex !== null && (
        <Lightbox
          photos={t.ticket_photos.map((p) => ({ url: p.file_url, name: p.file_name }))}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
        />
      )}
    </div>
  );
}

function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof MapPin;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-2.5">
      <Icon className="h-4 w-4 text-midnight-400 mt-0.5 shrink-0" strokeWidth={2} />
      <div className="min-w-0">
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-midnight-400">
          {label}
        </div>
        <div className="text-[13.5px] text-midnight-800">{children}</div>
      </div>
    </div>
  );
}

function SectionTitle({
  children,
  inline,
}: {
  children: React.ReactNode;
  inline?: boolean;
}) {
  return (
    <div
      className={
        "text-[10.5px] font-semibold uppercase tracking-wider text-midnight-500" +
        (inline ? "" : " px-2 pb-1.5 pt-1")
      }
    >
      {children}
    </div>
  );
}

function ActivityRow({ activity }: { activity: TicketActivity }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-midnight-300 shrink-0" />
      <div className="min-w-0">
        <div className="text-[12.5px] text-midnight-800">
          {activity.notes || prettyEvent(activity.event_type)}
        </div>
        <div className="text-[11px] text-midnight-400">
          {[activity.user_name, relativeTime(activity.created_at)]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
    </div>
  );
}

function prettyEvent(eventType: string): string {
  return eventType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
