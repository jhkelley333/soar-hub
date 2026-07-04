// /admin/labor-sync — pipeline health for the labor snapshot.
//
// Shows the most recent capture (business date, when it last changed,
// rows captured) and a per-day history table from labor_sync_state, plus
// a "Sync now" button that pulls the current sheet on demand (force=1).
// Admin / VP / COO only — backend gates the same set.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, CheckCircle2, AlertCircle, Microscope } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { fetchSyncStatus, triggerSyncDryRun, triggerSyncNow, type SyncDryRunResponse } from "./api";
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

  // Read-only diagnostic — fetches the sheet, returns the parsed column map +
  // a sample row. No DB writes. Surfaced as a collapsible panel below the
  // header so it's available when investigating suspect WTD/PTD values.
  const [dryRes, setDryRes] = useState<SyncDryRunResponse | null>(null);
  const dry = useMutation({
    mutationFn: triggerSyncDryRun,
    onSuccess: (res) => {
      setDryRes(res);
      toast.push("Column map fetched. See diagnostic panel below.", "success");
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Dry-run failed.", "error"),
  });

  const latest = q.data?.latest ?? null;

  // Staleness guard. The sheet normally lags ~1 day (yesterday's numbers land
  // today), so we flag when the last successful pull is over a day old OR the
  // latest captured sales date is more than one full day behind today — the
  // signature of the scheduled poll not firing.
  const STALE_HOURS = 24;
  const lastChangedMs = latest?.last_changed_at ? new Date(latest.last_changed_at).getTime() : NaN;
  const hoursSince = Number.isFinite(lastChangedMs) ? (Date.now() - lastChangedMs) / 3_600_000 : Infinity;
  const todayMid = new Date();
  todayMid.setHours(0, 0, 0, 0);
  const latestMid = latest ? new Date(`${latest.business_date}T00:00:00`) : null;
  const lagDays = latestMid ? Math.round((todayMid.getTime() - latestMid.getTime()) / 86_400_000) : Infinity;
  const stale = !q.isLoading && !q.isError && (!latest || hoursSince > STALE_HOURS || lagDays > 1);

  return (
    <>
      <PageHeader
        title="Labor sync"
        description="Pipeline health for the daily labor snapshot from the Google Sheet."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => dry.mutate()} disabled={dry.isPending}>
              <Microscope className={cn("mr-2 h-4 w-4", dry.isPending && "animate-pulse")} />
              {dry.isPending ? "Reading sheet…" : "Inspect sheet"}
            </Button>
            <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
              <RefreshCw className={cn("mr-2 h-4 w-4", sync.isPending && "animate-spin")} />
              {sync.isPending ? "Syncing…" : "Sync now"}
            </Button>
          </div>
        }
      />

      {dryRes && <SheetInspectorPanel result={dryRes} onClose={() => setDryRes(null)} />}

      {q.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : q.isError ? (
        <EmptyState title="Couldn't load sync status" description={(q.error as Error)?.message ?? "Try again."} />
      ) : (
        <div className="space-y-5">
          {stale && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div className="text-sm">
                <div className="font-semibold text-amber-900">Labor may not be auto-syncing.</div>
                <p className="mt-1 leading-relaxed text-amber-800">
                  Last successful pull <strong>{fmtAgo(latest?.last_changed_at ?? null)}</strong>
                  {latest ? (
                    <>
                      {" "}
                      ({fmtStamp(latest.last_changed_at)}); latest sales date {fmtDayLabel(latest.business_date)}.
                    </>
                  ) : (
                    "."
                  )}{" "}
                  The snapshot is set to poll every 15 minutes during business hours — if it keeps lagging, the scheduled{" "}
                  <code className="rounded bg-amber-100 px-1">labor-snapshot</code> function in Netlify likely isn't firing.
                  Hit <strong>Sync now</strong> to capture today, then verify the schedule in Netlify (Functions →
                  labor-snapshot).
                </p>
              </div>
            </div>
          )}

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

// Sheet column-map inspector — what columns we're reading from the sheet for
// each band, plus a 3-row sample of mapped values. Use this to confirm we're
// reading the right cells when WTD/PTD show suspect values app-wide.
function SheetInspectorPanel({
  result,
  onClose,
}: {
  result: SyncDryRunResponse;
  onClose: () => void;
}) {
  const m = result.column_map;
  const bandRows: Array<{ band: "daily" | "wtd" | "ptd"; fields: Record<string, string | null> }> = [
    { band: "daily", fields: m.daily },
    { band: "wtd", fields: m.wtd },
    { band: "ptd", fields: m.ptd },
  ];
  return (
    <div className="mb-5 rounded-xl border border-accent/30 bg-accent/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-midnight">Sheet inspector</div>
          <div className="mt-0.5 text-xs text-zinc-600">
            Read-only dry run · Sales Date <strong>{result.business_date}</strong> ·
            parsed {result.rows_parsed} row{result.rows_parsed === 1 ? "" : "s"} ·
            matched {result.stores_matched} store{result.stores_matched === 1 ? "" : "s"}
            {result.stores_orphaned.length > 0 && (
              <> · {result.stores_orphaned.length} orphaned (DI not in app)</>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-zinc-400 hover:text-zinc-700"
          aria-label="Close inspector"
        >
          ✕
        </button>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-[10px] uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-2 py-1">Band</th>
              <th className="px-2 py-1">labor_pct</th>
              <th className="px-2 py-1">sales</th>
              <th className="px-2 py-1">variance</th>
              <th className="px-2 py-1">$ over chart</th>
              <th className="px-2 py-1">hrs over chart</th>
            </tr>
          </thead>
          <tbody>
            {bandRows.map((b) => (
              <tr key={b.band} className="border-t border-zinc-100 font-mono">
                <td className="px-2 py-1.5 font-semibold uppercase text-midnight">{b.band}</td>
                <td className="px-2 py-1.5">{b.fields.labor_pct ?? "—"}</td>
                <td className="px-2 py-1.5">{b.fields.sales ?? "—"}</td>
                <td className="px-2 py-1.5">{b.fields.variance ?? "—"}</td>
                <td className="px-2 py-1.5">{b.fields.dollars_over ?? "—"}</td>
                <td className="px-2 py-1.5">{b.fields.hours_over ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-zinc-600 sm:grid-cols-4">
        <div>DI: <span className="font-mono text-midnight">{m.di ?? "—"}</span></div>
        <div>Location: <span className="font-mono text-midnight">{m.location ?? "—"}</span></div>
        <div>GM: <span className="font-mono text-midnight">{m.gm ?? "—"}</span></div>
        <div>DO: <span className="font-mono text-midnight">{m.do ?? "—"}</span></div>
        <div>SDO: <span className="font-mono text-midnight">{m.sdo ?? "—"}</span></div>
        <div>RVP: <span className="font-mono text-midnight">{m.rvp ?? "—"}</span></div>
        <div>Goal: <span className="font-mono text-midnight">{m.base_ptd_labor_goal ?? "—"}</span></div>
      </div>

      {result.sample.length > 0 && (
        <details className="mt-3 text-xs text-zinc-600">
          <summary className="cursor-pointer font-semibold text-midnight">
            Sample rows ({result.sample.length})
          </summary>
          <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-white p-3 text-[11px] ring-1 ring-zinc-200">
            {JSON.stringify(result.sample, null, 2)}
          </pre>
        </details>
      )}

      {/* Sheet-vs-app verdict: is what's stored for this Sales Date the same
          as what the sheet parses to right now? */}
      {result.verify && (
        <div
          className={cn(
            "mt-3 rounded-lg p-3 text-xs ring-1 ring-inset",
            result.verify.differing > 0 || result.verify.missing_in_db > 0
              ? "bg-red-50 text-red-800 ring-red-200"
              : "bg-emerald-50 text-emerald-800 ring-emerald-200",
          )}
        >
          <div className="font-semibold">
            {result.verify.differing > 0 || result.verify.missing_in_db > 0
              ? `App is OUT OF SYNC with the sheet for ${result.business_date}`
              : `App matches the sheet for ${result.business_date}`}
          </div>
          <div className="mt-1">
            {result.verify.identical} identical · {result.verify.differing} differing ·{" "}
            {result.verify.missing_in_db} missing in app · {result.verify.stored_rows_for_date} stored rows
            {result.verify.last_stored_sync && (
              <> · last stored sync {new Date(result.verify.last_stored_sync).toLocaleString()}</>
            )}
          </div>
          {result.verify.differing === 0 && result.verify.missing_in_db === 0 && (
            <div className="mt-1">
              If the numbers still look wrong, the SHEET itself is holding stale data — the app is
              faithfully reflecting it.
            </div>
          )}
          {result.verify.mismatches.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer font-semibold">
                Mismatches ({result.verify.mismatches.length}
                {result.verify.differing > result.verify.mismatches.length ? ` of ${result.verify.differing}` : ""})
              </summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-white p-3 text-[11px] text-zinc-800 ring-1 ring-zinc-200">
                {JSON.stringify(result.verify.mismatches, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
