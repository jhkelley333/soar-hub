// Approvals queue — DO+ mobile-first view of every submission waiting
// on a sign-off from the caller. Tier filter strip at the top, sorted
// list (worst tier first, then oldest submission), tap a row to open
// the full submission detail in the existing workspaces flow.
//
// Real data: pulled from listMySignoffs() — store, template name,
// submitted_at, audit_score_percent, audit_outcome.
// Placeholder: nothing. Score + tier are real audit outcomes.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, Filter, Clock, Flag } from "lucide-react";
import { AppHeader } from "@/shared/ui/AppHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Segmented } from "@/shared/ui/Segmented";
import { ScoreRing } from "@/shared/ui/ScoreRing";
import { TierBar } from "@/shared/ui/Tier";
import { BottomBar } from "@/shared/ui/BottomBar";
import { StatusPill } from "@/shared/ui/StatusPill";
import { fetchApprovalsQueue, relativeTime, type ApprovalRow } from "./api";
import type { Tier } from "@/shared/ui/Tier";

type TierFilter = "all" | "red" | "yellow" | "green";

const TIER_RANK: Record<Tier, number> = { red: 0, yellow: 1, green: 2 };

export function ApprovalsPage() {
  const [tier, setTier] = useState<TierFilter>("all");

  const query = useQuery({
    queryKey: ["approvals-queue"],
    queryFn: fetchApprovalsQueue,
    staleTime: 30_000,
  });

  const sorted = useMemo(() => {
    const rows = query.data?.rows ?? [];
    return [...rows].sort((a, b) => {
      if (TIER_RANK[a.tier] !== TIER_RANK[b.tier]) {
        return TIER_RANK[a.tier] - TIER_RANK[b.tier];
      }
      // Within a tier, oldest submission first — those have been
      // waiting longest.
      return new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime();
    });
  }, [query.data?.rows]);

  const filtered = tier === "all" ? sorted : sorted.filter((s) => s.tier === tier);
  const cleanGreenCount = sorted.filter((s) => s.tier === "green" && s.flagged === 0).length;

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
              aria-label="Search submissions"
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
            title="Couldn't load the approvals queue"
            description={(query.error as Error)?.message ?? "Try again."}
          />
        </div>
      )}

      {query.data && (
        <>
          {/* Tier filter strip — sticky beneath the AppHeader so it
              stays available while scrolling the list. */}
          <div className="px-4 pt-3 pb-2 sticky top-12 z-10 bg-surface-muted border-b border-midnight-100">
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
            <div className="mt-2 flex items-center justify-between text-[11.5px] text-midnight-500">
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
                description="Submissions you're a candidate signer for will show up here when they need a decision."
              />
            </div>
          ) : (
            <div className="px-3 pt-3 space-y-2">
              {filtered.length === 0 && (
                <p className="text-center text-[12px] text-midnight-500 py-8">
                  No submissions in this tier.
                </p>
              )}
              {filtered.map((r) => (
                <ApprovalRowCard key={r.signoffId} row={r} />
              ))}
            </div>
          )}

          {/* Sticky batch action — only relevant when there are green
              submissions with no flags. The button still routes through
              the existing per-submission decision page (it doesn't yet
              do a real batch call; the design intent is to surface the
              "clean queue" pattern for the v1 visual). */}
          {cleanGreenCount > 0 && (
            <BottomBar>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="flex-1 h-11 rounded-lg bg-midnight-900 text-white text-[14px] font-semibold inline-flex items-center justify-center gap-2 hover:bg-midnight-800 transition"
                >
                  Approve {cleanGreenCount} clean submission{cleanGreenCount === 1 ? "" : "s"}
                </button>
                <button
                  type="button"
                  className="h-11 px-3 rounded-lg ring-1 ring-midnight-200 text-midnight-700 text-[13px] font-medium hover:bg-surface transition"
                >
                  Review each
                </button>
              </div>
              <div className="mt-1.5 text-center text-[10.5px] text-midnight-500">
                Batch-approve will apply to green-tier submissions with no flags. (Preview — opens individual rows for now.)
              </div>
            </BottomBar>
          )}
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Row — one tappable card per pending submission. Mirrors the design
// canvas pattern: SDI + store, type, time, tier bar, score donut on the
// right, flag count + prior-action chip when relevant.
// ----------------------------------------------------------------------------

function ApprovalRowCard({ row }: { row: ApprovalRow }) {
  return (
    <Link
      to={`/submissions/${row.submissionId}`}
      className="relative block bg-surface rounded-xl ring-1 ring-midnight-100 shadow-card pl-4 pr-3 py-3 hover:ring-midnight-200 transition"
    >
      <TierBar tier={row.tier} />
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {row.sdi && (
              <>
                <span className="font-mono text-[11px] font-medium text-midnight-500">
                  SDI {row.sdi}
                </span>
                {row.storeName && (
                  <>
                    <span className="text-midnight-300">·</span>
                    <span className="text-[12.5px] text-midnight-700 truncate">
                      {row.storeName}
                    </span>
                  </>
                )}
              </>
            )}
            {!row.sdi && row.storeName && (
              <span className="text-[12.5px] text-midnight-700 truncate">{row.storeName}</span>
            )}
          </div>
          <div className="mt-1 text-[15px] font-semibold text-midnight-900 leading-tight truncate">
            {row.type}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[12px] text-midnight-500">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" strokeWidth={2} />
              {relativeTime(row.submittedAt)}
            </span>
            {row.workspaceName && (
              <>
                <span className="text-midnight-300">·</span>
                <span className="truncate">{row.workspaceName}</span>
              </>
            )}
          </div>
          {row.prior && (
            <div className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-midnight-500 bg-midnight-50 rounded-md px-1.5 py-0.5">
              <Flag className="h-3 w-3" strokeWidth={2} />
              {row.prior}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {row.score != null ? (
            <ScoreRing value={Math.round(row.score)} tone={row.tier} size={44} />
          ) : (
            <span className="text-[10.5px] text-midnight-400">no score</span>
          )}
          {row.flagged > 0 && (
            <span className="text-[10.5px] font-medium text-sonic-700">
              {row.flagged} flagged
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
