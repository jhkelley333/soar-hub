// /admin/google-reviews — Google Reviews (Tier A, Places API). Overall rating,
// sample distribution, worst locations, keyword tags, and a recent-review feed,
// scoped to the caller's org. Admin/VP/COO can Refresh (pull from Google).

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star, RefreshCw, AlertTriangle, ThumbsUp } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import { fetchReviewSummary, refreshReviews, type ReviewRow, type WorstLocation } from "./api";
import { ReviewTrends } from "./ReviewTrends";

const ratingTone = (r: number | null): string =>
  r == null ? "text-zinc-400" : r <= 2 ? "text-red-600" : r < 4 ? "text-amber-600" : "text-emerald-600";
const ratingChip = (r: number | null): string =>
  r == null ? "bg-zinc-100 text-zinc-500 ring-zinc-200"
    : r <= 2 ? "bg-red-50 text-red-700 ring-red-200"
    : r < 4 ? "bg-amber-50 text-amber-700 ring-amber-200"
    : "bg-emerald-50 text-emerald-700 ring-emerald-200";

function Stars({ n, className }: { n: number | null; className?: string }) {
  const v = Math.round(n ?? 0);
  return (
    <span className={cn("inline-flex", className)} aria-label={`${n ?? 0} stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cn("h-3.5 w-3.5", i <= v ? "fill-amber-400 text-amber-400" : "fill-zinc-200 text-zinc-200")} />
      ))}
    </span>
  );
}
const relTime = (iso: string | null, rel: string | null) =>
  rel || (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

export function GoogleReviewsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const canRefresh = ["admin", "vp", "coo"].includes(String(profile?.role ?? ""));

  const q = useQuery({ queryKey: ["google-reviews"], queryFn: fetchReviewSummary, staleTime: 60_000 });
  const data = q.data;

  const refresh = useMutation({
    mutationFn: () => refreshReviews(20),
    onSuccess: (r) => {
      toast.push(
        r.note ? r.note
          : `Refreshed ${r.refreshed} store${r.refreshed === 1 ? "" : "s"} from Google${r.remaining ? ` · ${r.remaining} still stale — click again to continue` : ""}.`,
        r.remaining ? "info" : "success",
      );
      qc.invalidateQueries({ queryKey: ["google-reviews"] });
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Refresh failed.", "error"),
  });

  const distMax = useMemo(() => {
    const d = data?.distribution;
    if (!d) return 0;
    return Math.max(d[1], d[2], d[3], d[4], d[5], 1);
  }, [data]);

  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader
        title="Google Reviews"
        description="Ratings, worst locations, and recent reviews across your stores — from Google."
        actions={canRefresh ? (
          <Button size="sm" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
            {refresh.isPending ? <><RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" /> Pulling…</> : <><RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh from Google</>}
          </Button>
        ) : undefined}
      />

      {q.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : q.isError ? (
        <EmptyState title="Couldn't load" description={(q.error as Error)?.message ?? "Try again."} />
      ) : !data?.configured ? (
        <EmptyState title="Google Places not configured" description="Set GOOGLE_PLACES_API_KEY in Netlify to enable Google Reviews." />
      ) : data.coverage.with_place_id === 0 ? (
        <EmptyState title="No Google listings linked yet" description="Reconcile stores in Hours of Operation (which resolves each store's Google place) first, then Refresh here." />
      ) : !data.overall ? (
        <EmptyState title="No data pulled yet" description={canRefresh ? "Click “Refresh from Google” to pull ratings and reviews." : "An admin needs to run a refresh to pull ratings and reviews."} />
      ) : (
        <>
          {/* overall + distribution */}
          <div className="grid gap-3 md:grid-cols-[220px_1fr]">
            <div className="flex flex-col items-center justify-center rounded-xl bg-white p-5 text-center ring-1 ring-zinc-200">
              <div className={cn("font-mono text-5xl font-black tabular-nums", ratingTone(data.overall.avg))}>{data.overall.avg.toFixed(1)}</div>
              <Stars n={data.overall.avg} className="mt-2" />
              <div className="mt-2 text-xs text-zinc-500">Weighted avg · {data.overall.stores} stores · {data.overall.total_reviews.toLocaleString()} reviews</div>
            </div>
            <div className="rounded-xl bg-white p-4 ring-1 ring-zinc-200">
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="text-sm font-bold text-midnight">Rating distribution</h3>
                <span className="text-[11px] text-zinc-400">sampled reviews ({data.distribution?.total ?? 0})</span>
              </div>
              <div className="space-y-1.5">
                {[5, 4, 3, 2, 1].map((s) => {
                  const c = data.distribution?.[s as 1 | 2 | 3 | 4 | 5] ?? 0;
                  const pct = data.distribution?.total ? Math.round((c / data.distribution.total) * 100) : 0;
                  return (
                    <div key={s} className="flex items-center gap-2 text-xs">
                      <span className="inline-flex w-8 items-center gap-0.5 font-semibold text-zinc-500">{s}<Star className="h-3 w-3 fill-amber-400 text-amber-400" /></span>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-zinc-100">
                        <div className={cn("h-full rounded-full", s >= 4 ? "bg-emerald-500" : s === 3 ? "bg-amber-400" : "bg-red-500")} style={{ width: `${(c / distMax) * 100}%` }} />
                      </div>
                      <span className="w-16 text-right font-mono tabular-nums text-zinc-500">{c} ({pct}%)</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* trend */}
          {data.trend && <ReviewTrends data={data.trend} />}

          {/* worst + keywords */}
          <div className="grid gap-3 md:grid-cols-3">
            <Panel title="Locations needing attention" icon={<AlertTriangle className="h-4 w-4 text-red-500" />}>
              {data.worst.length === 0 ? <Empty /> : data.worst.map((w) => <WorstRow key={w.number} w={w} />)}
            </Panel>
            <Panel title="Top issues" icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}>
              {data.keywords.issues.length === 0 ? <Empty text="No negative reviews collected yet." /> : data.keywords.issues.map((k) => (
                <TagRow key={k.word} word={k.word} count={k.count} tone="bg-red-50 text-red-700 ring-red-200" />
              ))}
            </Panel>
            <Panel title="Positive feedback" icon={<ThumbsUp className="h-4 w-4 text-emerald-500" />}>
              {data.keywords.positive.length === 0 ? <Empty text="No positive reviews collected yet." /> : data.keywords.positive.map((k) => (
                <TagRow key={k.word} word={k.word} count={k.count} tone="bg-emerald-50 text-emerald-700 ring-emerald-200" />
              ))}
            </Panel>
          </div>

          {/* recent feed */}
          <div>
            <h3 className="mb-2 px-1 text-sm font-bold text-midnight">Recent reviews {data.recent.length ? <span className="text-[11px] font-semibold text-zinc-400">· {data.recent.length}</span> : null}</h3>
            {data.recent.length === 0 ? (
              <div className="rounded-xl bg-white py-10 text-center text-sm text-zinc-400 ring-1 ring-zinc-200">No reviews collected yet — Google returns only recent reviews, so this fills in as you refresh.</div>
            ) : (
              <div className="space-y-2">{data.recent.map((r, i) => <ReviewCard key={i} r={r} />)}</div>
            )}
          </div>

          <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-[11px] leading-relaxed text-zinc-500">
            <b className="text-zinc-700">Tier A (Google Places API).</b> Overall rating and total counts are Google's exact aggregates; the review feed and distribution are a
            <b> rolling sample</b> (Places returns only the ~5 newest reviews per store, no history), so they grow as you refresh. Full history, the true star distribution,
            and replying from the Hub need the Google Business Profile API. Covering {data.coverage.rated} of {data.coverage.total} stores ({data.coverage.with_place_id} have a Google listing linked).
          </p>
        </>
      )}
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white p-3.5 ring-1 ring-zinc-200">
      <h4 className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-500">{icon}{title}</h4>
      <ul className="space-y-1">{children}</ul>
    </div>
  );
}
const Empty = ({ text = "Nothing yet." }: { text?: string }) => <li className="py-1 text-xs text-zinc-400">{text}</li>;

function WorstRow({ w }: { w: WorstLocation }) {
  return (
    <li className="flex items-center justify-between gap-2 border-b border-zinc-50 py-1.5 text-xs last:border-0">
      <span className="min-w-0 truncate"><b className="font-semibold text-midnight">{w.name}</b> <span className="font-mono text-zinc-400">#{w.number}</span></span>
      <span className="inline-flex shrink-0 items-center gap-1.5">
        <span className={cn("rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ring-1", ratingChip(w.rating))}>{w.rating.toFixed(1)}★</span>
        {w.count != null && <span className="text-zinc-400">{w.count}</span>}
      </span>
    </li>
  );
}
function TagRow({ word, count, tone }: { word: string; count: number; tone: string }) {
  return (
    <li className="flex items-center justify-between gap-2 py-1 text-xs">
      <span className="capitalize text-zinc-700">{word}</span>
      <span className={cn("rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold ring-1", tone)}>{count}</span>
    </li>
  );
}
function ReviewCard({ r }: { r: ReviewRow }) {
  return (
    <div className="rounded-xl bg-white p-3.5 ring-1 ring-zinc-200">
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
        <Stars n={r.rating} />
        <span className="font-semibold text-midnight">{r.author}</span>
        <span className="text-zinc-400">· {r.store}</span>
        <span className="ml-auto text-zinc-400">{relTime(r.review_time, r.relative_time)}</span>
      </div>
      {r.body && <p className="whitespace-pre-wrap text-sm text-zinc-600">{r.body}</p>}
    </div>
  );
}
