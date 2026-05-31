// /admin/labor-sync — pipeline health for the labor snapshot.
//
// Shows the most recent capture (business date, when it last changed,
// rows captured) and a per-day history table from labor_sync_state, plus
// a "Sync now" button that pulls the current sheet on demand (force=1).
// Admin / VP / COO only — backend gates the same set.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { fetchSyncStatus, triggerSyncNow } from "./api";
import { fmtDayLabel } from "./format";

function fmtAgo(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function fmtStamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function LaborSyncPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["labor-sync-status"], queryFn: fetchSyncStatus });

  const sync = useMutation({
    mutationFn: triggerSyncNow,
    onSuccess: (res) => {
      const n = res.upserted ?? 0;
      toast.push(
        res.skipped
          ? `No change for ${res.business_date} — already up to date.`
          : `Synced ${res.business_date}: ${n} store${n === 1 ? "" : "s"} captured.`,
        "success"
      );
      qc.invalidateQueries({ queryKey: ["labor-sync-status"] });
      qc.invalidateQueries({ queryKey: ["labor-district"] });
      qc.invalidateQueries({ queryKey: ["labor-gm"] });
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Sync failed.", "error"),
  });

  const latest = q.data?.latest ?? null;

  return (
    <>
      <PageHeader
        title="Labor sync"
        description="Pipeline health for the daily labor snapshot from the Google Sheet."
        actions={
          <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
            <RefreshCw className={cn("mr-2 h-4 w-4", sync.isPending && "animate-spin")} />
            {sync.isPending ? "Syncing…" : "Sync now"}
          </Button>
        }
      />

      {q.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : q.isError ? (
        <EmptyState title="Couldn't load sync status" description={(q.error as Error)?.message ?? "Try again."} />
      ) : (
        <div className="space-y-5">
          {/* Latest-capture summary tiles */}
          <div className="grid gap-4 md:grid-cols-4">
            <Tile label="Latest sales date" value={latest ? fmtDayLabel(latest.business_date) : "—"} />
            <Tile label="Last changed" value={fmtAgo(latest?.last_changed_at ?? null)} sub={fmtStamp(latest?.last_changed_at ?? null)} />
            <Tile label="Stores captured" value={latest ? String(latest.rows_captured) : "—"}
              sub={latest && latest.stores_orphaned > 0 ? `${latest.stores_orphaned} unmatched` : "all matched"}
              tone={latest && latest.stores_orphaned > 0 ? "warn" : "ok"} />
            <Tile label="Total history rows" value={String(q.data?.total_snapshot_rows ?? 0)} sub="across all days" />
          </div>

          {/* Per-day history */}
          {!q.data?.days.length ? (
            <EmptyState
              title="No syncs yet"
              description="Hit “Sync now” to pull the current sheet, or wait for the next scheduled poll."
            />
          ) : (
            <div className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-[11px] uppercase tracking-wide text-zinc-400">
                    <th className="px-4 py-3 font-semibold">Sales date</th>
                    <th className="px-4 py-3 font-semibold">Stores</th>
                    <th className="px-4 py-3 font-semibold">Unmatched</th>
                    <th className="px-4 py-3 font-semibold">Changes</th>
                    <th className="px-4 py-3 font-semibold">Polls</th>
                    <th className="px-4 py-3 font-semibold">Last changed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {q.data.days.map((d) => (
                    <tr key={d.business_date} className="text-midnight">
                      <td className="px-4 py-3 font-medium">{fmtDayLabel(d.business_date)}</td>
                      <td className="px-4 py-3 tabular-nums">{d.rows_captured}</td>
                      <td className="px-4 py-3 tabular-nums">
                        {d.stores_orphaned > 0 ? (
                          <span className="inline-flex items-center gap-1 text-warn">
                            <AlertCircle className="h-3.5 w-3.5" />
                            {d.stores_orphaned}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-ok">
                            <CheckCircle2 className="h-3.5 w-3.5" />0
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums">{d.change_count}</td>
                      <td className="px-4 py-3 tabular-nums text-zinc-500">{d.poll_count}</td>
                      <td className="px-4 py-3 text-zinc-500">{fmtStamp(d.last_changed_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function Tile({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "ok" | "warn" | "neutral";
}) {
  const valueColor = tone === "warn" ? "text-warn" : tone === "ok" ? "text-midnight" : "text-midnight";
  return (
    <div className="rounded-xl bg-white p-5 ring-1 ring-zinc-200">
      <div className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</div>
      <div className={cn("mt-1 text-2xl font-bold tabular-nums", valueColor)}>{value}</div>
      {sub && <div className="mt-1 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}
