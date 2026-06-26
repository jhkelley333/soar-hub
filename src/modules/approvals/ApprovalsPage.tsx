// Unified approvals queue — DO+ mobile-first view of every pending
// decision the caller owns, across three sources:
//
//   - Workspace sign-offs (audits / walkthroughs / forms)
//   - PAF approvals (bonus PAFs awaiting SDO+)
//   - Work order quote / emergency approvals
//
// Tier filter + source filter at the top, sorted list (worst tier
// first, then oldest), tap a row to open its native detail page.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Search, Filter, Clock, Flag,
  Wallet, Users, FileText, Hammer,
} from "lucide-react";
import { AppHeader } from "@/shared/ui/AppHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Segmented } from "@/shared/ui/Segmented";
import { ScoreRing } from "@/shared/ui/ScoreRing";
import { TierBar } from "@/shared/ui/Tier";
import { StatusPill } from "@/shared/ui/StatusPill";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import {
  fetchApprovalsQueue,
  formatDollars,
  relativeTime,
  type ApprovalItem,
  type ApprovalSource,
} from "./api";
import type { Tier } from "@/shared/ui/Tier";

type TierFilter = "all" | "red" | "yellow" | "green";
type SourceFilter = "all" | ApprovalSource;

const TIER_RANK: Record<Tier, number> = { red: 0, yellow: 1, green: 2 };

const SOURCE_ICON: Record<ApprovalSource, typeof Hammer> = {
  work_order: Hammer,
  paf: FileText,
  cash: Wallet,
  employee_action: Users,
};

export function ApprovalsPage() {
  const { profile } = useAuth();
  const [tier, setTier] = useState<TierFilter>("all");
  const [source, setSource] = useState<SourceFilter>("all");

  const query = useQuery({
    queryKey: ["approvals-queue", profile?.role],
    queryFn: () => fetchApprovalsQueue(profile?.role ?? null),
    staleTime: 30_000,
    enabled: !!profile,
  });

  const sorted = useMemo(() => {
    const items = query.data?.items ?? [];
    return [...items].sort((a, b) => {
      if (TIER_RANK[a.tier] !== TIER_RANK[b.tier]) {
        return TIER_RANK[a.tier] - TIER_RANK[b.tier];
      }
      return new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime();
    });
  }, [query.data?.items]);

  const filtered = sorted.filter((s) => {
    if (tier !== "all" && s.tier !== tier) return false;
    if (source !== "all" && s.source !== source) return false;
    return true;
  });

  return (
    <div className="mx-auto w-full max-w-md bg-surface-muted min-h-full pb-32">
      <AppHeader
        title="Approvals"
        subtitle={
          query.data
            ? `${query.data.counts.all} awaiting review`
            : "Loading…"
        }
        trailing={
          <div className="flex items-center gap-2">
            <StatusPill kind="synced">Synced</StatusPill>
            <button
              type="button"
              className="text-midnight-500 hover:text-midnight-800"
              aria-label="Search approvals"
            >
              <Search className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        }
      />

      {query.isLoading && (
        <div className="p-4 space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {query.isError && (
        <div className="p-4">
          <EmptyState
            title="Couldn't load approvals"
            description={(query.error as Error)?.message ?? "Try again."}
          />
        </div>
      )}

      {query.data && (
        <>
          {/* Filter band — sticky beneath the header. Two segments:
              tier (urgency) and source (where it came from). */}
          <div className="px-4 pt-3 pb-2 sticky top-12 z-10 bg-surface-muted border-b border-midnight-100 space-y-2">
            <Segmented<TierFilter>
              value={tier}
              onChange={setTier}
              options={[
                { value: "all", label: "All", count: query.data.counts.all },
                { value: "red", label: "Red", count: query.data.counts.red, dot: "tier-red" },
                { value: "yellow", label: "Yellow", count: query.data.counts.yellow, dot: "tier-yellow" },
                { value: "green", label: "Green", count: query.data.counts.green, dot: "tier-green" },
              ]}
            />
            <div className="flex items-center justify-between">
              <Segmented<SourceFilter>
                dense
                value={source}
                onChange={setSource}
                options={[
                  { value: "all", label: "All sources" },
                  { value: "work_order", label: "Work orders", count: query.data.bySource.work_order },
                  { value: "paf", label: "PAFs", count: query.data.bySource.paf },
                  { value: "cash", label: "Cash", count: query.data.bySource.cash },
                  { value: "employee_action", label: "Employee", count: query.data.bySource.employee_action },
                ]}
              />
            </div>
            <div className="flex items-center justify-between text-[11.5px] text-midnight-500">
              <span>Sorted by tier, then submission time</span>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-midnight-600 hover:text-midnight-800"
              >
                <Filter className="h-3 w-3" strokeWidth={2} />
                Filters
              </button>
            </div>
          </div>

          {/* List */}
          {query.data.counts.all === 0 ? (
            <div className="px-4 pt-8">
              <EmptyState
                title="Nothing waiting on you"
                description="When cash, employee actions, work order approvals, or PAFs need your attention they'll appear here."
              />
            </div>
          ) : (
            <div className="px-3 pt-3 space-y-2">
              {filtered.length === 0 && (
                <p className="text-center text-[12px] text-midnight-500 py-8">
                  No items match the current filters.
                </p>
              )}
              {filtered.map((item) => (
                <ApprovalCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Row — one card per pending item. The source determines the right-
// side affordance: workspace audits show a score donut; PAFs and work
// orders show the dollar amount. Tier bar + flag chip + prior-action
// chip are shared across sources.
// ----------------------------------------------------------------------------

function ApprovalCard({ item }: { item: ApprovalItem }) {
  const SourceIcon = SOURCE_ICON[item.source];
  return (
    <Link
      to={item.deepLink}
      className="relative block bg-surface rounded-xl ring-1 ring-midnight-100 shadow-card pl-4 pr-3 py-3 hover:ring-midnight-200 transition"
    >
      <TierBar tier={item.tier} />
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <SourceIcon className="h-3 w-3 text-midnight-400" strokeWidth={2} />
            <span className="text-[10.5px] font-semibold uppercase tracking-wider text-midnight-500">
              {item.sourceLabel}
            </span>
            {item.sdi && (
              <>
                <span className="text-midnight-300">·</span>
                <span className="font-mono text-[11px] font-medium text-midnight-500">
                  SDI {item.sdi}
                </span>
              </>
            )}
            {!item.sdi && item.storeName && (
              <>
                <span className="text-midnight-300">·</span>
                <span className="text-[12px] text-midnight-700 truncate">
                  {item.storeName}
                </span>
              </>
            )}
          </div>
          <div className="mt-1 text-[15px] font-semibold text-midnight-900 leading-tight truncate">
            {item.title}
          </div>
          {item.subtitle && (
            <div className="text-[12px] text-midnight-500 truncate">
              {item.subtitle}
            </div>
          )}
          <div className="mt-1 flex items-center gap-2 text-[12px] text-midnight-500">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" strokeWidth={2} />
              {relativeTime(item.submittedAt)}
            </span>
          </div>
          {item.prior && (
            <div className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-midnight-500 bg-midnight-50 rounded-md px-1.5 py-0.5">
              <Flag className="h-3 w-3" strokeWidth={2} />
              {item.prior}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {item.score != null ? (
            <ScoreRing value={Math.round(item.score)} tone={item.tier} size={44} />
          ) : item.amount != null ? (
            <div className="text-[15px] font-semibold tabular-nums text-midnight-900 leading-none">
              {formatDollars(item.amount)}
            </div>
          ) : (
            <span className="text-[10.5px] text-midnight-400">—</span>
          )}
          {item.flagged > 0 && (
            <span className={cn(
              "text-[10.5px] font-medium",
              item.tier === "red" ? "text-sonic-700" : "text-midnight-600",
            )}>
              {item.tier === "red" ? "Emergency" : `${item.flagged} flagged`}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
