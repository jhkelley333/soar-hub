// /admin/weather-sync — admin tools for the weather pipeline.
//
// Two actions, both admin-only (backend gates the same):
//   • Sync now — pull current conditions + forecast for every city (same
//     core the schedule runs).
//   • Backfill — pull historical daily highs/lows from the Open-Meteo
//     archive for a date range. The backend processes a slice of cities per
//     call, so we loop until it reports `done`, showing progress.

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, CloudSun, History } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { triggerWeatherSync, backfillWeatherHistory } from "@/modules/dashboard/weatherApi";

// Local YYYY-MM-DD (avoid UTC off-by-one near midnight).
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// A range ending yesterday (the archive lags the live day), spanning `days`.
function pastRange(days: number): { start: string; end: string } {
  const end = new Date();
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  return { start: ymd(start), end: ymd(end) };
}

interface Progress {
  label: string;
  processed: number;
  total: number;
  inserted: number;
  failed: number;
  reason?: string | null;
}

export function WeatherSyncPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const sync = useMutation({
    mutationFn: triggerWeatherSync,
    onSuccess: (r) => {
      if (r.ok === false || r.error) {
        toast.push(r.error || r.reason || "Sync failed.", "error");
        return;
      }
      toast.push(
        `Synced ${r.recorded} of ${r.locations} cities${r.failed ? `, ${r.failed} failed` : ""}.`,
        "success"
      );
      qc.invalidateQueries({ queryKey: ["weather"] });
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Sync failed.", "error"),
  });

  async function runBackfill(label: string, startDate: string, endDate: string) {
    if (busy) return;
    setBusy(true);
    setProgress({ label, processed: 0, total: 0, inserted: 0, failed: 0 });
    try {
      const LIMIT = 12;
      let offset = 0;
      let inserted = 0;
      let failed = 0;
      let total = 0;
      let reason: string | null = null;
      // Loop a slice of cities per request until the backend says it's done.
      for (;;) {
        const r = await backfillWeatherHistory({ start_date: startDate, end_date: endDate, offset, limit: LIMIT });
        if (!r.ok) throw new Error(r.error || "Backfill failed.");
        total = r.total;
        inserted += r.inserted;
        failed += r.failed;
        if (r.error) reason = r.error;
        offset += LIMIT;
        setProgress({ label, processed: Math.min(offset, total), total, inserted, failed, reason });
        if (r.done) break;
      }
      toast.push(
        `Backfilled ${label}: ${inserted} day-row${inserted === 1 ? "" : "s"} across ${total} cit${total === 1 ? "y" : "ies"}${failed ? `, ${failed} failed — ${reason ?? "see details"}` : ""}.`,
        failed ? "info" : "success"
      );
      qc.invalidateQueries({ queryKey: ["weather"] });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Backfill failed.";
      // A multi-minute backfill outlives a single access token if the device
      // sleeps or changes networks mid-loop; Supabase's background refresh
      // can come back with a dead refresh token, which surfaces here as
      // "Not signed in" / "unauthorized". Each loop iteration commits its
      // own slice and skips days already recorded, so nothing already
      // pulled is lost — just point the admin at signing back in + re-running.
      const isAuthFailure = /not signed in|unauthorized|refresh token/i.test(message);
      toast.push(
        isAuthFailure
          ? "Your session timed out partway through the backfill. Sign back in and run it again — already-pulled days are skipped, so it picks up where it left off."
          : message,
        "error"
      );
    } finally {
      setBusy(false);
    }
  }

  const backfillPast = (days: number, label: string) => {
    const { start: s, end: e } = pastRange(days);
    runBackfill(label, s, e);
  };

  const pct =
    progress && progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Weather sync"
        description="Pull current conditions now, or backfill historical daily highs/lows for your cities."
        actions={
          <Button onClick={() => sync.mutate()} disabled={sync.isPending || busy}>
            <RefreshCw className={cn("mr-2 h-4 w-4", sync.isPending && "animate-spin")} />
            {sync.isPending ? "Syncing…" : "Sync now"}
          </Button>
        }
      />

      <div className="space-y-5">
        {/* Sync explainer */}
        <div className="flex items-start gap-3 rounded-xl bg-white p-5 ring-1 ring-zinc-200">
          <CloudSun className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
          <div className="text-sm">
            <div className="font-semibold text-midnight">Current conditions</div>
            <p className="mt-1 leading-relaxed text-zinc-600">
              <strong>Sync now</strong> pulls today's conditions and forecast for every city via the
              schedule's data source. Runs automatically a few times a day — use this to force an
              immediate refresh.
            </p>
          </div>
        </div>

        {/* Backfill */}
        <div className="rounded-xl bg-white p-5 ring-1 ring-zinc-200">
          <div className="flex items-start gap-3">
            <History className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
            <div className="text-sm">
              <div className="font-semibold text-midnight">Backfill history</div>
              <p className="mt-1 leading-relaxed text-zinc-600">
                Fills in daily highs/lows from the Open-Meteo archive so trend charts have history.
                Safe to re-run — existing days are replaced, not duplicated.
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => backfillPast(7, "past 7 days")}>
              Past 7 days
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => backfillPast(30, "past 30 days")}>
              Past 30 days
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => backfillPast(90, "past 90 days")}>
              Past 90 days
            </Button>
          </div>

          {/* Custom range */}
          <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-zinc-100 pt-4">
            <label className="text-xs text-zinc-500">
              <span className="mb-1 block font-medium">Start</span>
              <input
                type="date"
                value={start}
                max={end || undefined}
                onChange={(e) => setStart(e.target.value)}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-midnight"
              />
            </label>
            <label className="text-xs text-zinc-500">
              <span className="mb-1 block font-medium">End</span>
              <input
                type="date"
                value={end}
                min={start || undefined}
                onChange={(e) => setEnd(e.target.value)}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-midnight"
              />
            </label>
            <Button
              variant="secondary"
              disabled={busy || !start || !end || start > end}
              onClick={() => runBackfill(`${start} → ${end}`, start, end)}
            >
              Backfill range
            </Button>
          </div>

          {/* Progress */}
          {progress && (
            <div className="mt-4 rounded-lg bg-zinc-50 p-4 text-sm ring-1 ring-zinc-200">
              <div className="flex items-center justify-between">
                <span className="font-medium text-midnight">
                  {busy ? "Backfilling" : "Backfilled"} {progress.label}
                </span>
                <span className="tabular-nums text-zinc-500">
                  {progress.processed}/{progress.total || "…"} cities
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-200">
                <div
                  className={cn("h-full rounded-full bg-accent transition-all", busy && "animate-pulse")}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-zinc-500">
                {progress.inserted} day-rows written
                {progress.failed > 0 && <span className="text-warn"> · {progress.failed} failed</span>}
              </div>
              {progress.failed > 0 && progress.reason && (
                <div className="mt-1 text-xs text-warn">{progress.reason}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
