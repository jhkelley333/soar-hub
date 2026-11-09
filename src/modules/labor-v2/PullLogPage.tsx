// /admin/labor-v2/log — pull log for the KPI feed capture + Labor v2 pulls.
// Shows each pull (scheduled cron, manual refresh, self-heal) with status,
// what it wrote, and any error. Admin-only; auto-refreshes.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, GitCompareArrows, RefreshCw, Wrench, XCircle } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { cn } from "@/lib/cn";
import { correctDailyRow, fetchDataRevisions, fetchPullLog, type DataRevision, type DailyRowCorrectionInput, type PullLogEntry } from "./api";

const fmtVal = (v: number | null) => (v == null ? "—" : Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { maximumFractionDigits: 4 }));

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

  const revQ = useQuery({
    queryKey: ["labor-v2-data-revisions"],
    queryFn: () => fetchDataRevisions(),
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
  const revisions = revQ.data?.entries ?? [];

  return (
    <>
      <PageHeader
        title="Pull log"
        description="KPI feed capture + labor pulls — status, what landed, and errors."
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
        <EmptyState title="No pulls logged yet" description="Pulls appear here after the next scheduled capture (7 AM–10 PM CT) or a manual refresh." />
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

      {/* Manual correction panel */}
      <div className="mt-8">
        <ManualCorrectionPanel />
      </div>

      {/* Data revisions — a re-pull changed an already-captured value. */}
      <div className="mt-8">
        <div className="mb-2 flex items-center gap-2">
          <GitCompareArrows className="h-4 w-4 text-zinc-400" />
          <h2 className="text-sm font-semibold text-midnight dark:text-night-ink">Data revisions</h2>
          <span className="text-[11px] text-zinc-400">a re-pull changed an already-captured value · the sheet was updated (latest wins)</span>
        </div>
        {revQ.data?.note ? (
          <EmptyState title="Not available yet" description={revQ.data.note} />
        ) : revisions.length === 0 ? (
          <EmptyState title="No restatements" description="Every re-pull so far has matched the captured data. Changes will list here." />
        ) : (
          <Card>
            <CardBody className="p-0">
              <div className="border-b border-zinc-100 px-4 py-2 text-[11px] text-zinc-400">{revisions.length} recent change{revisions.length === 1 ? "" : "s"}</div>
              <div className="divide-y divide-zinc-100">
                {revisions.map((r) => <RevisionRow key={r.id} r={r} />)}
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}

function RevisionRow({ r }: { r: DataRevision }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-xs">
      <span className="w-32 shrink-0 text-zinc-400">{fmtTime(r.detected_at)}</span>
      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", r.source === "labor" ? "bg-accent-100 text-accent-700" : "bg-sky-50 text-sky-700")}>{r.source}</span>
      <span className="font-medium text-midnight dark:text-night-ink">#{r.store_number}</span>
      <span className="text-zinc-400">{r.business_date}</span>
      <span className="font-mono text-zinc-600">{r.field}</span>
      <span className="tabular-nums text-zinc-500">{fmtVal(r.old_value)}</span>
      <span className="text-zinc-300">→</span>
      <span className="font-semibold tabular-nums text-midnight dark:text-night-ink">{fmtVal(r.new_value)}</span>
      {r.pull_source && <span className="text-[10px] text-zinc-300">({SOURCE_LABEL[r.pull_source] ?? r.pull_source})</span>}
    </div>
  );
}

const CORRECTABLE: { key: keyof DailyRowCorrectionInput; label: string }[] = [
  { key: "net_sales", label: "Net Sales ($)" },
  { key: "labor_cost", label: "Labor Cost ($)" },
  { key: "labor_hours", label: "Labor Hours" },
  { key: "labor_pct", label: "Labor % (decimal, e.g. 0.21)" },
  { key: "target_labor_pct", label: "Target Labor % (decimal)" },
  { key: "wtd_net_sales", label: "WTD Net Sales ($)" },
  { key: "wtd_labor_cost", label: "WTD Labor Cost ($)" },
  { key: "wtd_labor_hours", label: "WTD Labor Hours" },
  { key: "wtd_target_labor_pct", label: "WTD Target Labor % (decimal)" },
  { key: "ptd_net_sales", label: "PTD Net Sales ($)" },
  { key: "ptd_labor_cost", label: "PTD Labor Cost ($)" },
  { key: "ptd_labor_hours", label: "PTD Labor Hours" },
];

function ManualCorrectionPanel() {
  const qc = useQueryClient();
  const [storeNumber, setStoreNumber] = useState("");
  const [businessDate, setBusinessDate] = useState("");
  const [reason, setReason] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: (input: DailyRowCorrectionInput) => correctDailyRow(input),
    onSuccess: (data) => {
      setSuccess(`Corrected ${data.fields_corrected.join(", ")} for store ${data.store_number} on ${data.business_date}.`);
      setStoreNumber(""); setBusinessDate(""); setReason(""); setFields({});
      qc.invalidateQueries({ queryKey: ["labor-v2-data-revisions"] });
      qc.invalidateQueries({ queryKey: ["labor-v2-pull-log"] });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSuccess(null);
    const payload: DailyRowCorrectionInput = { store_number: storeNumber, business_date: businessDate, reason };
    for (const { key } of CORRECTABLE) {
      const v = fields[key as string];
      if (v !== undefined && v !== "") (payload as Record<string, unknown>)[key] = Number(v);
    }
    mut.mutate(payload);
  }

  const inputCls = "w-full rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-midnight placeholder:text-zinc-400 focus:border-accent-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-night-ink";

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Wrench className="h-4 w-4 text-zinc-400" />
        <h2 className="text-sm font-semibold text-midnight dark:text-night-ink">Manual daily correction</h2>
        <span className="text-[11px] text-zinc-400">fix a specific store/date row when Inventory Express corrects data after the fact</span>
      </div>
      <Card>
        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-zinc-500 uppercase tracking-wide">Store #</label>
                <input className={inputCls} placeholder="e.g. 1832" value={storeNumber} onChange={(e) => setStoreNumber(e.target.value)} required />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-zinc-500 uppercase tracking-wide">Business Date</label>
                <input type="date" className={inputCls} value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} required />
              </div>
              <div className="sm:col-span-1">
                <label className="mb-1 block text-[11px] font-medium text-zinc-500 uppercase tracking-wide">Reason (required)</label>
                <input className={inputCls} placeholder="e.g. IE outage on 11/3; corrected 11/9" value={reason} onChange={(e) => setReason(e.target.value)} required />
              </div>
            </div>

            <div>
              <p className="mb-2 text-[11px] text-zinc-400">Fill in only the fields that need correcting — leave the rest blank.</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
                {CORRECTABLE.map(({ key, label }) => (
                  <div key={key}>
                    <label className="mb-0.5 block text-[11px] text-zinc-500">{label}</label>
                    <input
                      type="number" step="any" className={inputCls}
                      placeholder="—"
                      value={fields[key as string] ?? ""}
                      onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            </div>

            {mut.isError && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
                {(mut.error as Error)?.message ?? "Something went wrong."}
              </p>
            )}
            {success && (
              <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                ✓ {success}
              </p>
            )}

            <div className="flex justify-end">
              <button type="submit" disabled={mut.isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50">
                {mut.isPending ? "Saving…" : "Apply correction"}
              </button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
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
