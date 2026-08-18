import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Database, Play, RefreshCw } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { fetchBackfillStatus, startBackfill } from "./rankerBackfillApi";

export function RankerBackfillPage() {
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const pollRef = useRef<number | null>(null);

  const statusQ = useQuery({ queryKey: ["ranker-backfill-status"], queryFn: fetchBackfillStatus });

  // While a backfill is running, poll status every 4s so the counts climb live.
  useEffect(() => {
    if (!running) return;
    pollRef.current = window.setInterval(() => statusQ.refetch(), 4000);
    // Stop auto-polling after ~5 min as a backstop.
    const stop = window.setTimeout(() => setRunning(false), 5 * 60 * 1000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      window.clearTimeout(stop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  async function run() {
    try {
      await startBackfill();
      setRunning(true);
      toast.push("Backfill started — reading the sheet + DB. Counts will climb below.", "success");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Couldn't start backfill.", "error");
    }
  }

  const s = statusQ.data;

  return (
    <>
      <PageHeader
        title="Ranker history backfill"
        description="Migrate every ranker week — the legacy v1 Google Sheet weeks plus the v2 database weeks — into one Supabase table for cross-week analysis."
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => statusQ.refetch()} disabled={statusQ.isFetching}>
              <RefreshCw className={`mr-1 h-3.5 w-3.5 ${statusQ.isFetching ? "animate-spin" : ""}`} strokeWidth={2} />
              Refresh
            </Button>
            <Button onClick={run} disabled={running}>
              <Play className="mr-1 h-4 w-4" strokeWidth={2} />
              {running ? "Running…" : "Run backfill"}
            </Button>
          </div>
        }
      />

      <Card className="mb-6">
        <CardHeader title="What this does" />
        <CardBody>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
            <li>Reads each week tab from the Culture/Ranker Google Sheet (v1) and every completed <span className="font-mono text-xs">ranking_rows</span> run (v2).</li>
            <li>Writes one row per store per week into <span className="font-mono text-xs">ranker_week_history</span> — rank + GM, tagged by source.</li>
            <li><b>Idempotent</b> — safe to re-run any time; it refreshes existing rows and adds new weeks.</li>
            <li>Runs in the background (it's a lot of data), so this page just watches the totals climb.</li>
          </ul>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Total rows" value={s?.rows_total} icon />
        <Stat label="From v1 sheet" value={s?.rows_sheet} />
        <Stat label="From v2 database" value={s?.rows_db} />
      </div>

      <p className="mt-4 text-xs text-ink-muted">
        {s?.last_imported_at
          ? `Last import: ${new Date(s.last_imported_at).toLocaleString()}.`
          : "No backfill has run yet."}
        {running && " Refreshing every few seconds while the job runs…"}
      </p>

      {statusQ.isError && (
        <p className="mt-3 text-sm text-red-600">
          {statusQ.error instanceof Error ? statusQ.error.message : "Couldn't load status."}
          {" "}If this says the table is missing, apply migration 0295 first.
        </p>
      )}
    </>
  );
}

function Stat({ label, value, icon }: { label: string; value?: number; icon?: boolean }) {
  return (
    <Card>
      <CardBody>
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
          {icon && <Database className="h-3.5 w-3.5 text-accent" strokeWidth={2} />}
          {label}
        </div>
        <div className="mt-1 text-3xl font-bold tabular-nums text-heading">
          {value == null ? "—" : value.toLocaleString()}
        </div>
      </CardBody>
    </Card>
  );
}
