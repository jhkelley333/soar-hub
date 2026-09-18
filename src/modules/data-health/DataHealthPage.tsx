// /admin/data-health — data pipeline health dashboard for finance/admin.
// Shows KPI stream summaries, 30-day store coverage grid, missing/incomplete
// stores per day, and a recent pull log.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, CheckCircle2, RefreshCw, XCircle, AlertTriangle, Database, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { cn } from "@/lib/cn";
import {
  fetchDataHealthOverview,
  fetchCoverageDetail,
  type OverviewResponse,
  type CoverageDetailResponse,
} from "./api";

const fmt = (d: string | null) =>
  d
    ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "—";

const fmtTime = (s: string) =>
  new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function coverageColor(pct: number): string {
  if (pct >= 0.9) return "bg-emerald-500";
  if (pct >= 0.7) return "bg-yellow-400";
  if (pct >= 0.4) return "bg-orange-400";
  return "bg-red-500";
}

function coverageTextColor(pct: number): string {
  if (pct >= 0.9) return "text-emerald-700";
  if (pct >= 0.7) return "text-yellow-700";
  if (pct >= 0.4) return "text-orange-700";
  return "text-red-700";
}

export function DataHealthPage() {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const overviewQ = useQuery({
    queryKey: ["data-health-overview"],
    queryFn: fetchDataHealthOverview,
    refetchOnWindowFocus: true,
    refetchInterval: 120_000,
  });

  const detailQ = useQuery({
    queryKey: ["data-health-detail", selectedDate],
    queryFn: () => fetchCoverageDetail(selectedDate!),
    enabled: !!selectedDate,
  });

  const ov: OverviewResponse | undefined = overviewQ.data;
  const totalStores = ov?.total_stores ?? 0;
  const recentPulls = (ov?.pull_log ?? []).slice(0, 10);

  return (
    <>
      <PageHeader
        title="Data Health"
        description="KPI pipeline coverage, missing stores, and stream status for the finance team."
        actions={
          <button
            onClick={() => overviewQ.refetch()}
            disabled={overviewQ.isFetching}
            className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 ring-1 ring-inset ring-zinc-200 hover:bg-zinc-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", overviewQ.isFetching && "animate-spin")} />
            Refresh
          </button>
        }
      />

      {overviewQ.isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
          <Skeleton className="h-48 w-full" />
        </div>
      ) : overviewQ.isError ? (
        <EmptyState
          title="Couldn't load data health"
          description={(overviewQ.error as Error)?.message ?? "Try again."}
        />
      ) : ov ? (
        <div className="space-y-6">
          {/* ── Streams ── */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-midnight dark:text-night-ink">
              <Database className="h-4 w-4 text-zinc-400" />
              Data Streams
            </h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {ov.streams.map((s) => (
                <Card key={s.name}>
                  <CardBody className="p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{s.label}</div>
                    <div className="mt-1 text-sm font-medium text-midnight dark:text-night-ink">{s.description}</div>
                    <div className="mt-3 space-y-1 text-xs text-zinc-500">
                      <div className="flex justify-between">
                        <span>Capturing since</span>
                        <span className="font-medium text-midnight dark:text-night-ink">{fmt(s.first_date)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Latest data</span>
                        <span className="font-medium text-midnight dark:text-night-ink">{fmt(s.last_date)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Total rows</span>
                        <span className="font-medium text-midnight dark:text-night-ink">{s.total_rows.toLocaleString()}</span>
                      </div>
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          </section>

          {/* ── 30-day coverage grid ── */}
          <section>
            <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-midnight dark:text-night-ink">
              <Activity className="h-4 w-4 text-zinc-400" />
              Daily Store Coverage — last 30 days
            </h2>
            <p className="mb-3 text-xs text-zinc-400">
              {totalStores} active stores. Click a date to see which stores are missing.
            </p>
            <Card>
              <CardBody className="p-4">
                {ov.coverage.length === 0 ? (
                  <p className="text-xs text-zinc-400">No coverage data yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {ov.coverage.map(({ date, store_count }) => {
                      const pct = totalStores > 0 ? store_count / totalStores : 0;
                      const isSelected = date === selectedDate;
                      return (
                        <button
                          key={date}
                          onClick={() => setSelectedDate(date === selectedDate ? null : date)}
                          title={`${date}: ${store_count}/${totalStores} stores (${Math.round(pct * 100)}%)`}
                          className={cn(
                            "flex h-10 w-14 flex-col items-center justify-center rounded text-[10px] font-medium transition-all",
                            coverageColor(pct),
                            "text-white hover:opacity-80",
                            isSelected && "ring-2 ring-offset-1 ring-zinc-700",
                          )}
                        >
                          <span>{date.slice(5)}</span>
                          <span className="opacity-80">{store_count}/{totalStores}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-4 text-[10px] text-zinc-500">
                  {[
                    { color: "bg-emerald-500", label: "≥ 90%" },
                    { color: "bg-yellow-400", label: "70–89%" },
                    { color: "bg-orange-400", label: "40–69%" },
                    { color: "bg-red-500", label: "< 40%" },
                  ].map(({ color, label }) => (
                    <div key={label} className="flex items-center gap-1">
                      <span className={cn("inline-block h-2.5 w-2.5 rounded-sm", color)} />
                      {label}
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          </section>

          {/* ── Coverage detail panel ── */}
          {selectedDate && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-midnight dark:text-night-ink">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Store Detail — {selectedDate}
              </h2>
              {detailQ.isLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : detailQ.isError ? (
                <EmptyState title="Couldn't load detail" description={(detailQ.error as Error)?.message ?? "Try again."} />
              ) : detailQ.data ? (
                <DetailPanel detail={detailQ.data} />
              ) : null}
            </section>
          )}

          {/* ── Recent pulls ── */}
          <section>
            <h2 className="mb-3 flex items-center justify-between text-sm font-semibold text-midnight dark:text-night-ink">
              <span className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-zinc-400" />
                Recent Pulls
              </span>
              <Link
                to="/admin/labor-v2/log"
                className="flex items-center gap-1 text-xs font-normal text-accent-600 hover:underline"
              >
                Full pull log <ExternalLink className="h-3 w-3" />
              </Link>
            </h2>
            <Card>
              <CardBody className="p-0">
                {recentPulls.length === 0 ? (
                  <EmptyState title="No recent pulls" description="Pulls appear here after the next scheduled capture." />
                ) : (
                  <div className="divide-y divide-zinc-100">
                    {recentPulls.map((e) => (
                      <div key={e.id} className="flex items-start gap-3 px-4 py-3">
                        {e.ok
                          ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                          : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-midnight dark:text-night-ink">
                              {fmtTime(e.created_at)}
                            </span>
                            {e.business_date && (
                              <span className="text-[11px] text-zinc-400">{e.business_date}</span>
                            )}
                          </div>
                          {e.ok ? (
                            <div className="mt-0.5 text-xs text-zinc-500">
                              {e.store_rows ?? 0} stores
                              {e.kpi_snapshot ? " · snapshot saved" : ""}
                              {e.duration_ms != null ? ` · ${(e.duration_ms / 1000).toFixed(1)}s` : ""}
                            </div>
                          ) : (
                            <div className="mt-0.5 break-words text-xs text-red-600">{e.error || "Failed."}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          </section>
        </div>
      ) : null}
    </>
  );
}

function DetailPanel({ detail }: { detail: CoverageDetailResponse }) {
  const coveragePct = detail.total_stores > 0 ? detail.present_count / detail.total_stores : 0;

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg bg-zinc-50 px-4 py-3 text-sm ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800/40">
        <span className={cn("font-semibold", coverageTextColor(coveragePct))}>
          {detail.present_count} / {detail.total_stores} stores reported
          {" "}({Math.round(coveragePct * 100)}%)
        </span>
        {detail.missing.length > 0 && (
          <span className="text-zinc-500">{detail.missing.length} missing</span>
        )}
        {detail.incomplete.length > 0 && (
          <span className="text-amber-600">{detail.incomplete.length} incomplete</span>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Missing stores */}
        <Card>
          <CardBody className="p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Missing Stores ({detail.missing.length})
            </div>
            {detail.missing.length === 0 ? (
              <p className="text-xs text-emerald-600">All stores reported data for this date.</p>
            ) : (
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {detail.missing.map((s) => (
                  <div key={s.number} className="flex items-center justify-between text-xs">
                    <span className="font-medium text-midnight dark:text-night-ink">#{s.number}</span>
                    <span className="text-zinc-500 truncate ml-2">{s.name ?? "—"}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-3 text-[10px] text-zinc-400 italic">
              Phase 2: manual data correction for missing stores will be added here.
            </p>
          </CardBody>
        </Card>

        {/* Incomplete rows */}
        <Card>
          <CardBody className="p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Incomplete Rows ({detail.incomplete.length})
            </div>
            {detail.incomplete.length === 0 ? (
              <p className="text-xs text-emerald-600">All present stores have complete key fields.</p>
            ) : (
              <div className="max-h-56 space-y-2 overflow-y-auto">
                {detail.incomplete.map((r) => (
                  <div key={r.store_number} className="text-xs">
                    <span className="font-medium text-midnight dark:text-night-ink">#{r.store_number}</span>
                    <span className="ml-2 text-amber-600">
                      missing: {r.missing_fields.join(", ")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Pull attempts for this date */}
      {detail.pulls_for_date.length > 0 && (
        <Card>
          <CardBody className="p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Pull Attempts for {detail.date}
            </div>
            <div className="space-y-1.5">
              {detail.pulls_for_date.map((e) => (
                <div key={e.id} className="flex items-start gap-2 text-xs">
                  {e.ok
                    ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />}
                  <span className="text-zinc-500">{fmtTime(e.created_at)}</span>
                  {e.ok
                    ? <span className="text-zinc-500">{e.store_rows ?? 0} stores{e.duration_ms != null ? ` · ${(e.duration_ms / 1000).toFixed(1)}s` : ""}</span>
                    : <span className="break-words text-red-600">{e.error || "Failed."}</span>}
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
