// /admin/labor-v2/log — pull log for the KPI feed capture + Labor v2 pulls.
// Shows each pull (scheduled cron, manual refresh, self-heal) with status,
// what it wrote, and any error. Admin-only; auto-refreshes.

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { cn } from "@/lib/cn";
import { fetchPullLog, type PullLogEntry } from "./api";

const fmtTime = (s: string) =>
  new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const SOURCE_LABEL: Record<string, string> = { cron: "Scheduled", refresh: "Manual refresh", "self-heal": "Self-heal" };
const SOURCE_TONE: Record<string, string> = {
  cron: "bg-accent-100 text-accent-700",
  refresh: "bg-zinc-100 text-zinc-600",
  "self-heal": "bg-amber-50 text-amber-700",
};

export function PullLogPage() {
  const q = useQuery({
    queryKey: ["labor-v2-pull-log"],
    queryFn: fetchPullLog,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
  const entries = q.data?.entries ?? [];
  const okCount = entries.filter((e) => e.ok).length;

  return (
    <>
      <PageHeader
        title="Pull log"
        description="KPI feed capture + Labor v2 pulls — status, what landed, and errors."
        actions={
          <button onClick={() => q.refetch()} disabled={q.isFetching}
            className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 ring-1 ring-inset ring-zinc-200 hover:bg-zinc-50">
            <RefreshCw className={cn("h-3.5 w-3.5", q.isFetching && "animate-spin")} /> Refresh
          </button>
        }
      />

      {q.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : q.isError ? (
        <EmptyState title="Couldn't load the pull log" description={(q.error as Error)?.message ?? "Try again."} />
      ) : entries.length === 0 ? (
        <EmptyState title="No pulls logged yet" description="Pulls appear here after the next scheduled capture (7 AM–2 PM CT) or a manual refresh." />
      ) : (
        <Card>
          <CardBody className="p-0">
            <div className="border-b border-zinc-100 px-4 py-2 text-[11px] text-zinc-400">
              {entries.length} recent pulls · {okCount} ok · {entries.length - okCount} failed
            </div>
            <div className="divide-y divide-zinc-100">
              {entries.map((e) => <Row key={e.id} e={e} />)}
            </div>
          </CardBody>
        </Card>
      )}
    </>
  );
}

function Row({ e }: { e: PullLogEntry }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      {e.ok
        ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-midnight dark:text-night-ink">{fmtTime(e.created_at)}</span>
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", SOURCE_TONE[e.source] ?? "bg-zinc-100 text-zinc-600")}>
            {SOURCE_LABEL[e.source] ?? e.source}
          </span>
          {e.central_hour != null && <span className="text-[11px] text-zinc-400">{e.central_hour}:00 CT</span>}
          {e.triggered_by && <span className="truncate text-[11px] text-zinc-400">by {e.triggered_by}</span>}
        </div>
        {e.ok ? (
          <div className="mt-0.5 text-xs text-zinc-500">
            {e.business_date ? `${e.business_date} · ` : ""}{e.store_rows ?? 0} stores
            {e.wtd_rows != null ? ` · WTD ${e.wtd_rows} · PTD ${e.ptd_rows}` : ""}
            {e.kpi_snapshot ? " · snapshot saved" : ""}
            {e.duration_ms != null ? ` · ${(e.duration_ms / 1000).toFixed(1)}s` : ""}
          </div>
        ) : (
          <div className="mt-0.5 break-words text-xs text-red-600">{e.error || "Failed."}</div>
        )}
      </div>
    </div>
  );
}
