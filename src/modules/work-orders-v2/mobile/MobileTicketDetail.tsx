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
import { ChevronLeft, Clock, MapPin, Wrench, User2, RefreshCw } from "lucide-react";
import { AppHeader } from "@/shared/ui/AppHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Avatar } from "@/shared/ui/Avatar";
import { Lightbox } from "@/shared/ui/Lightbox";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import { fetchTicket, markTicketSeen } from "../api";
import { TicketChat } from "../TicketChat";
import { DiscussButton } from "@/modules/chat/DiscussButton";
import { ApprovalSection } from "../ApprovalSection";
import { CostHero } from "./CostHero";
import { ApprovalChain } from "./ApprovalChain";
import { ApprovalActionBar } from "./ApprovalActionBar";
import { QuotesSection } from "./QuotesSection";
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

  const approvals = t?.ticket_approvals ?? [];
  // Pick the newest approval by requested_at — NOT array position.
  // PostgREST doesn't guarantee embed order, and an UPDATE (e.g. a
  // rejection) can reshuffle it, which left the card stuck showing a
  // stale "Rejected" after the vendor resubmitted.
  const latest =
    approvals.length > 0
      ? [...approvals].sort(
          (a, b) =>
            new Date(a.requested_at).getTime() - new Date(b.requested_at).getTime(),
        )[approvals.length - 1]
      : null;
  const pending = latest?.status === "Pending" ? latest : null;
  const canDecide = !!pending && isApprover(profile?.role);

  // The committed/recommended quote — approving commits this one.
  const recommendedQuote =
    (t?.ticket_quotes ?? []).find((qz) => qz.is_recommended) ??
    (t?.ticket_quotes ?? [])[0] ??
    null;

  // Evidence excludes quote attachments — those live in the Quotes
  // section (vendor-submitted quotes also land in ticket_photos as
  // upload_type='quote', and a quote PDF would render as a broken image).
  const evidencePhotos = (t?.ticket_photos ?? []).filter(
    (p) => p.upload_type !== "quote",
  );

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

          {t.awaiting_info && (
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 ring-1 ring-amber-200 px-4 py-2.5">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" strokeWidth={2} />
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold text-amber-800">
                  Needs info — awaiting reply
                </div>
                {t.info_request_note && (
                  <div className="truncate text-[11.5px] text-amber-700">
                    {t.info_request_note}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Request — the scope of work, set by the vendor (or internal
              on their behalf) when a quote is submitted. Read-only here:
              it follows the quote, not an approver's edit. */}
          <section className="bg-surface rounded-xl ring-1 ring-midnight-100 shadow-card p-4">
            <SectionTitle inline>Request</SectionTitle>
            {t.work_requested ? (
              <h1 className="mt-1 text-[17px] font-semibold text-midnight-900 leading-snug">
                {t.work_requested}
              </h1>
            ) : (
              <>
                <h1 className="mt-1 text-[17px] font-semibold italic text-midnight-300 leading-snug">
                  e.g., Replace motor and belt
                </h1>
                <p className="mt-0.5 text-[11.5px] text-midnight-400">
                  Comes from the vendor's quote.
                </p>
              </>
            )}
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
          </section>

          {/* Evidence */}
          {evidencePhotos.length > 0 && (
            <section>
              <SectionTitle>Evidence · {evidencePhotos.length} photos</SectionTitle>
              <div className="grid grid-cols-3 gap-2 px-1">
                {evidencePhotos.map((p, i) => (
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

          {/* Quotes — vendor + total + attached file; pick a winner. */}
          <QuotesSection ticket={t} onChanged={refreshTicket} />

          {/* Line items — optional internal breakdown, if present. */}
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

          <section>
            <DiscussButton
              scopeKind="workorder"
              scopeRef={t.id}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-surface px-3 py-2.5 text-[13px] font-semibold text-midnight-700 shadow-card ring-1 ring-midnight-100 disabled:opacity-50"
            />
          </section>

          {/* Messages */}
          <section>
            <SectionTitle>Messages</SectionTitle>
            <div className="bg-surface rounded-xl ring-1 ring-midnight-100 shadow-card p-3">
              <TicketChat ticketId={t.id} onError={(msg) => toast.push(msg, "error")} />
            </div>
          </section>
        </div>
      )}

      {/* Sticky approval bar — only for an approver with a pending row. */}
      {t && canDecide && pending && (
        <ApprovalActionBar
          ticket={t}
          approval={pending}
          quoteId={recommendedQuote?.id ?? null}
          amountCents={
            recommendedQuote
              ? recommendedQuote.amount_cents
              : Math.round((Number(t.cost_estimate) || 0) * 100)
          }
          onChanged={refreshTicket}
        />
      )}

      {evidencePhotos.length > 0 && lightboxIndex !== null && (
        <Lightbox
          photos={evidencePhotos.map((p) => ({ url: p.file_url, name: p.file_name }))}
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

