// Mobile ticket detail — Phase 1: read-only.
//
// Fetches the full ticket (photos + approvals + activity feed) via
// fetchTicket(). Phase 2 adds the status-transition action bar and chat
// composer; Phase 4 wires the approval decision buttons. For now this
// surfaces everything a user needs to understand the ticket at a glance.

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Clock, MapPin, Wrench, User2, DollarSign } from "lucide-react";
import { AppHeader } from "@/shared/ui/AppHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { StatusPill } from "@/shared/ui/StatusPill";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import { fetchTicket, markTicketSeen } from "../api";
import { statusLabel, type TicketActivity } from "../types";
import { StatusBar } from "../StatusBar";
import { TicketActionBar } from "../TicketActionBar";
import { TicketChat } from "../TicketChat";
import { ApprovalSection } from "../ApprovalSection";
import { priorityChipClass, relativeTime, formatDollars } from "./woMobile";

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

  const q = useQuery({
    queryKey: ["wo2-ticket", ticketId],
    queryFn: () => fetchTicket(ticketId).then((r) => r.ticket),
    staleTime: 15_000,
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

  return (
    <div className="mx-auto w-full max-w-md bg-surface-muted min-h-full">
      <AppHeader
        title={t ? t.wo_number : "Work order"}
        subtitle={t ? statusLabel(t.status) : "Loading…"}
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
      />

      {q.isLoading && (
        <div className="p-4 space-y-3">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
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
        <div className="px-3 pt-3 pb-16 space-y-3">
          {/* Header card — issue + status + priority */}
          <section className="bg-surface rounded-xl ring-1 ring-midnight-100 shadow-card p-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={cn(
                  "text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5",
                  priorityChipClass(t.priority),
                )}
              >
                {t.priority}
              </span>
              {t.is_business_critical && (
                <span className="text-[10px] font-semibold uppercase tracking-wide text-sonic-700">
                  Business critical
                </span>
              )}
              <StatusPill kind="pending" className="ml-auto">
                {statusLabel(t.status)}
              </StatusPill>
            </div>
            <h1 className="mt-2 text-[17px] font-semibold text-midnight-900 leading-snug">
              {t.issue_description || t.category || "Work order"}
            </h1>
            <div className="mt-1 text-[12px] text-midnight-500 inline-flex items-center gap-1">
              <Clock className="h-3 w-3" strokeWidth={2} />
              Submitted {relativeTime(t.date_submitted)}
              {t.submitted_by ? ` by ${t.submitted_by}` : ""}
            </div>
          </section>

          {/* Detail facts */}
          <section className="bg-surface rounded-xl ring-1 ring-midnight-100 shadow-card divide-y divide-midnight-100">
            <Fact icon={MapPin} label="Store">
              SDI {t.store_number}
              {t.store_name ? ` · ${t.store_name}` : ""}
            </Fact>
            {(t.category || t.asset_type) && (
              <Fact icon={Wrench} label="Asset">
                {[t.category, t.asset_type, t.model_number]
                  .filter(Boolean)
                  .join(" · ")}
              </Fact>
            )}
            {t.vendor_name && (
              <Fact icon={User2} label="Vendor">
                {t.vendor_name}
              </Fact>
            )}
            {formatDollars(t.cost_estimate) && (
              <Fact icon={DollarSign} label="Cost estimate">
                {formatDollars(t.cost_estimate)}
              </Fact>
            )}
          </section>

          {/* Photos */}
          {t.ticket_photos && t.ticket_photos.length > 0 && (
            <section>
              <SectionTitle>Photos</SectionTitle>
              <div className="grid grid-cols-3 gap-2 px-1">
                {t.ticket_photos.map((p) => (
                  <a
                    key={p.id}
                    href={p.file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="block aspect-square rounded-lg overflow-hidden ring-1 ring-midnight-100 bg-surface-sunk"
                  >
                    <img
                      src={p.file_url}
                      alt={p.file_name ?? "Ticket photo"}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  </a>
                ))}
              </div>
            </section>
          )}

          {/* Approval — request a quote sign-off, or (DO+) approve/reject
              the pending one. Reuses the desktop ApprovalSection, which
              role-gates the decide buttons client-side and is enforced
              server-side. This is what the Approvals-queue deep-link
              lands on. */}
          <section>
            <div className="bg-surface rounded-xl ring-1 ring-midnight-100 shadow-card p-4">
              <ApprovalSection
                ticket={t}
                callerRole={profile?.role ?? ""}
                onChanged={() => {
                  qc.invalidateQueries({ queryKey: ["wo2-ticket", ticketId] });
                  qc.invalidateQueries({ queryKey: ["wo2", "tickets"] });
                }}
                onError={(msg) => toast.push(msg, "error")}
              />
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

          {/* Actions — lifecycle bar + contextual transition buttons.
              Reuses the desktop TicketActionBar (state machine + reason
              modals), which validates server-side and refreshes both
              the list and this detail on success. */}
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

          {/* Messages — internal + vendor threads. */}
          <section>
            <SectionTitle>Messages</SectionTitle>
            <div className="bg-surface rounded-xl ring-1 ring-midnight-100 shadow-card p-3">
              <TicketChat
                ticketId={t.id}
                onError={(msg) => toast.push(msg, "error")}
              />
            </div>
          </section>
        </div>
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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-1.5 pt-1 text-[10.5px] font-semibold uppercase tracking-wider text-midnight-500">
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
  return eventType
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
